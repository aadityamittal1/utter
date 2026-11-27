//! Minimal Anthropic Messages API client (raw HTTPS; there is no official Rust SDK).

use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

pub const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";
pub const ANTHROPIC_VERSION: &str = "2026-10-21";
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Thinking {
    /// Cleanup: no thinking, lowest latency.
    Disabled,
    /// Enhance / command / transform: adaptive thinking at low effort.
    AdaptiveLow,
}

#[derive(Debug, Clone)]
pub struct CompletionRequest {
    pub system: String,
    pub user: String,
    pub max_tokens: u32,
    pub thinking: Thinking,
    /// Ask for `{"text": "..."}` via `output_config.format` and unwrap it (cleanup only).
    pub structured: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Completion {
    pub text: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub model: String,
}

/// Errors from the Claude API. `Display` never includes the API key.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LlmError {
    #[error("no API key set")]
    NoKey,
    /// The key was rejected (HTTP status when known).
    #[error("the API key was rejected")]
    Auth(Option<u16>),
    #[error("rate limited by the API")]
    RateLimited,
    #[error("the model declined to respond")]
    Refusal,
    #[error("the response was cut off (max tokens)")]
    MaxTokens,
    #[error("the response was empty")]
    Empty,
    #[error("the response was not the expected JSON")]
    BadFormat,
    #[error("the request timed out")]
    Timeout,
    #[error("network error: {0}")]
    Network(String),
    #[error("API error {status}: {message}")]
    Api { status: u16, message: String },
}

/// Build the JSON body for `POST /v1/messages`. Never includes
/// `temperature`, `top_p` or `top_k`.
pub fn request_body(model: &str, req: &CompletionRequest) -> Value {
    let mut body = json!({
        "model": model,
        "max_tokens": req.max_tokens,
        "system": req.system,
        "messages": [{ "role": "user", "content": req.user }],
    });
    match req.thinking {
        Thinking::Disabled => {
            body["thinking"] = json!({ "type": "disabled" });
        }
        Thinking::AdaptiveLow => {
            body["thinking"] = json!({ "type": "adaptive" });
            body["output_config"] = json!({ "effort": "low" });
        }
    }
    if req.structured {
        // Structured output: the model must return {"text": "..."}; `format` sits next to
        // `effort` inside `output_config`.
        body["output_config"]["format"] = json!({
            "type": "json_schema",
            "schema": {
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"],
                "additionalProperties": false,
            },
        });
    }
    body
}

/// Unwrap `{"text": "..."}` (structured cleanup output).
fn unwrap_structured(text: &str) -> Result<String, LlmError> {
    let v: Value = serde_json::from_str(text.trim()).map_err(|_| LlmError::BadFormat)?;
    match v["text"].as_str() {
        Some(t) if !t.trim().is_empty() => Ok(t.to_string()),
        Some(_) => Err(LlmError::Empty),
        None => Err(LlmError::BadFormat),
    }
}

#[derive(Deserialize)]
struct ApiResponse {
    #[serde(default)]
    content: Vec<ContentBlock>,
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    usage: Option<Usage>,
    #[serde(default)]
    model: Option<String>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize, Default)]
struct Usage {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
}

/// Interpret a successful (2xx) response body.
fn parse_completion(body: &str, fallback_model: &str) -> Result<Completion, LlmError> {
    let resp: ApiResponse = serde_json::from_str(body)
        .map_err(|e| LlmError::Network(format!("unreadable response: {e}")))?;
    match resp.stop_reason.as_deref() {
        Some("refusal") => return Err(LlmError::Refusal),
        Some("max_tokens") => return Err(LlmError::MaxTokens),
        _ => {}
    }
    // Only `text` blocks; `thinking` (and any other) blocks are ignored.
    let text: String = resp
        .content
        .iter()
        .filter(|b| b.kind == "text")
        .filter_map(|b| b.text.as_deref())
        .collect();
    if text.trim().is_empty() {
        // An empty string would otherwise replace the user's selection.
        return Err(LlmError::Empty);
    }
    let usage = resp.usage.unwrap_or_default();
    Ok(Completion {
        text,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        model: resp.model.unwrap_or_else(|| fallback_model.to_string()),
    })
}

fn error_from_status(status: u16, body: &str) -> LlmError {
    match status {
        401 | 403 => LlmError::Auth(Some(status)),
        429 => LlmError::RateLimited,
        _ => {
            let message = serde_json::from_str::<Value>(body)
                .ok()
                .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
                .unwrap_or_else(|| "request failed".to_string());
            LlmError::Api {
                status,
                message: truncate(&message, 300),
            }
        }
    }
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

pub struct ClaudeClient {
    http: reqwest::Client,
    key: String,
    model: String,
    base_url: String,
}

impl ClaudeClient {
    pub fn new(api_key: String, model: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            // Building only fails on TLS backend init errors, which are unrecoverable;
            // no default-client fallback, since it would silently drop the 15 s timeout.
            .expect("reqwest client builds");
        Self {
            http,
            key: api_key.trim().to_string(),
            model,
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    /// Point the client at another host (tests).
    pub fn with_base_url(mut self, url: String) -> Self {
        self.base_url = url.trim_end_matches('/').to_string();
        self
    }

    /// `Bearer <key>` as a sensitive header value (excluded from debug output).
    fn key_header(&self) -> Result<reqwest::header::HeaderValue, LlmError> {
        let mut v = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", self.key))
            .map_err(|_| LlmError::Auth(None))?;
        v.set_sensitive(true);
        Ok(v)
    }

    fn map_send_err(e: reqwest::Error) -> LlmError {
        if e.is_timeout() {
            LlmError::Timeout
        } else {
            // reqwest errors can embed the URL; they never contain header values.
            LlmError::Network(e.without_url().to_string())
        }
    }

    pub async fn complete(&self, req: &CompletionRequest) -> Result<Completion, LlmError> {
        if self.key.trim().is_empty() {
            return Err(LlmError::NoKey);
        }
        let resp = self
            .http
            .post(format!("{}/v1/messages", self.base_url))
            .header(reqwest::header::AUTHORIZATION, self.key_header()?)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .body(request_body(&self.model, req).to_string())
            .send()
            .await
            .map_err(Self::map_send_err)?;
        let status = resp.status().as_u16();
        let body = resp.text().await.map_err(Self::map_send_err)?;
        if !(200..300).contains(&status) {
            return Err(error_from_status(status, &body));
        }
        let mut c = parse_completion(&body, &self.model)?;
        if req.structured {
            c.text = unwrap_structured(&c.text)?;
        }
        Ok(c)
    }

    /// Free key check: `GET /v1/models?limit=1`.
    pub async fn validate(&self) -> Result<(), LlmError> {
        if self.key.trim().is_empty() {
            return Err(LlmError::NoKey);
        }
        let resp = self
            .http
            .get(format!("{}/v1/models?limit=1", self.base_url))
            .header(reqwest::header::AUTHORIZATION, self.key_header()?)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .send()
            .await
            .map_err(Self::map_send_err)?;
        let status = resp.status().as_u16();
        if (200..300).contains(&status) {
            return Ok(());
        }
        log::warn!("API key check failed: HTTP {status}");
        let body = resp.text().await.unwrap_or_default();
        Err(error_from_status(status, &body))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(thinking: Thinking) -> CompletionRequest {
        CompletionRequest {
            system: "sys".into(),
            user: "usr".into(),
            max_tokens: 100,
            thinking,
            structured: false,
        }
    }

    fn client(server: &mockito::ServerGuard) -> ClaudeClient {
        ClaudeClient::new("sk-ant-secret".into(), "claude-haiku-5-5".into())
            .with_base_url(server.url())
    }

    #[test]
    fn cleanup_body_shape() {
        let b = request_body("claude-haiku-5-5", &req(Thinking::Disabled));
        assert_eq!(b["model"], "claude-haiku-5-5");
        assert_eq!(b["max_tokens"], 100);
        assert_eq!(b["system"], "sys");
        assert_eq!(b["messages"][0]["role"], "user");
        assert_eq!(b["messages"][0]["content"], "usr");
        assert_eq!(b["thinking"]["type"], "disabled");
        assert!(b.get("output_config").is_none());
        for k in ["temperature", "top_p", "top_k"] {
            assert!(b.get(k).is_none(), "{k} must not be sent");
        }
    }

    fn structured_req() -> CompletionRequest {
        CompletionRequest {
            structured: true,
            ..req(Thinking::Disabled)
        }
    }

    #[test]
    fn structured_body_uses_json_schema_output_format() {
        let b = request_body("claude-haiku-5-5", &structured_req());
        assert_eq!(b["thinking"]["type"], "disabled");
        let f = &b["output_config"]["format"];
        assert_eq!(f["type"], "json_schema");
        assert_eq!(f["schema"]["type"], "object");
        assert_eq!(f["schema"]["properties"]["text"]["type"], "string");
        assert_eq!(f["schema"]["required"], serde_json::json!(["text"]));
        assert_eq!(f["schema"]["additionalProperties"], false);
        for k in ["temperature", "top_p", "top_k"] {
            assert!(b.get(k).is_none());
        }
    }

    #[tokio::test]
    async fn structured_response_is_unwrapped_from_the_text_field() {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/v1/messages")
            .match_body(mockito::Matcher::PartialJsonString(
                r#"{"output_config":{"format":{"type":"json_schema"}}}"#.into(),
            ))
            .with_status(200)
            .with_body(
                r#"{"stop_reason":"end_turn","content":[{"type":"text","text":"{\"text\":\"Write me a haiku about rain.\"}"}],"usage":{"input_tokens":3,"output_tokens":4}}"#,
            )
            .create_async()
            .await;
        let c = client(&server).complete(&structured_req()).await.unwrap();
        assert_eq!(c.text, "Write me a haiku about rain.");
        assert_eq!(c.output_tokens, 4);
    }

    #[tokio::test]
    async fn structured_response_that_is_not_the_json_is_a_failure() {
        for text in [
            "Waves crash softly on the shore.",
            r#"{"answer":"Paris"}"#,
            r#"{"text":42}"#,
            r#"{"text":"  "}"#,
        ] {
            let mut server = mockito::Server::new_async().await;
            let body = serde_json::json!({
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": text}],
                "usage": {"input_tokens": 1, "output_tokens": 1}
            })
            .to_string();
            let _m = server
                .mock("POST", "/v1/messages")
                .with_status(200)
                .with_body(body)
                .create_async()
                .await;
            let err = client(&server)
                .complete(&structured_req())
                .await
                .unwrap_err();
            assert!(
                matches!(err, LlmError::BadFormat | LlmError::Empty),
                "{text}: {err:?}"
            );
        }
    }

    #[test]
    fn enhance_body_shape() {
        let b = request_body("claude-haiku-5-5", &req(Thinking::AdaptiveLow));
        assert_eq!(b["thinking"]["type"], "adaptive");
        assert_eq!(b["output_config"]["effort"], "low");
        for k in ["temperature", "top_p", "top_k"] {
            assert!(b.get(k).is_none());
        }
    }

    #[tokio::test]
    async fn concatenates_text_blocks_and_reads_usage() {
        let mut server = mockito::Server::new_async().await;
        let m = server
            .mock("POST", "/v1/messages")
            .match_header("anthropic-version", "2026-10-21")
            .match_header("authorization", "Bearer sk-ant-secret")
            .match_header("content-type", "application/json")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{"model":"claude-haiku-5-5","stop_reason":"end_turn",
                "content":[{"type":"thinking","thinking":"hmm"},
                           {"type":"text","text":"Hello, "},
                           {"type":"text","text":"world."}],
                "usage":{"input_tokens":12,"output_tokens":5}}"#,
            )
            .create_async()
            .await;
        let c = client(&server)
            .complete(&req(Thinking::Disabled))
            .await
            .unwrap();
        assert_eq!(c.text, "Hello, world.");
        assert_eq!(c.input_tokens, 12);
        assert_eq!(c.output_tokens, 5);
        assert_eq!(c.model, "claude-haiku-5-5");
        m.assert_async().await;
    }

    #[tokio::test]
    async fn maps_401_to_auth_and_429_to_rate_limited() {
        let mut server = mockito::Server::new_async().await;
        let _a = server
            .mock("POST", "/v1/messages")
            .with_status(401)
            .with_body("{}")
            .create_async()
            .await;
        let err = client(&server)
            .complete(&req(Thinking::Disabled))
            .await
            .unwrap_err();
        assert_eq!(err, LlmError::Auth(Some(401)));

        let mut server = mockito::Server::new_async().await;
        let _b = server
            .mock("POST", "/v1/messages")
            .with_status(429)
            .with_body("{}")
            .create_async()
            .await;
        let err = client(&server)
            .complete(&req(Thinking::Disabled))
            .await
            .unwrap_err();
        assert_eq!(err, LlmError::RateLimited);
    }

    #[tokio::test]
    async fn maps_5xx_to_api_error_with_message() {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/v1/messages")
            .with_status(529)
            .with_body(
                r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#,
            )
            .create_async()
            .await;
        let err = client(&server)
            .complete(&req(Thinking::Disabled))
            .await
            .unwrap_err();
        assert_eq!(
            err,
            LlmError::Api {
                status: 529,
                message: "Overloaded".into()
            }
        );
    }

    #[tokio::test]
    async fn refusal_and_max_tokens_are_failures() {
        for (reason, expected) in [
            ("refusal", LlmError::Refusal),
            ("max_tokens", LlmError::MaxTokens),
        ] {
            let mut server = mockito::Server::new_async().await;
            let body = format!(
                r#"{{"stop_reason":"{reason}","content":[{{"type":"text","text":"partial"}}],"usage":{{"input_tokens":1,"output_tokens":1}}}}"#
            );
            let _m = server
                .mock("POST", "/v1/messages")
                .with_status(200)
                .with_body(body)
                .create_async()
                .await;
            let err = client(&server)
                .complete(&req(Thinking::Disabled))
                .await
                .unwrap_err();
            assert_eq!(err, expected);
        }
    }

    #[tokio::test]
    async fn empty_key_is_no_key() {
        let c = ClaudeClient::new("  ".into(), "m".into());
        assert_eq!(
            c.complete(&req(Thinking::Disabled)).await.unwrap_err(),
            LlmError::NoKey
        );
        assert_eq!(c.validate().await.unwrap_err(), LlmError::NoKey);
    }

    #[tokio::test]
    async fn validate_uses_models_endpoint() {
        let mut server = mockito::Server::new_async().await;
        let m = server
            .mock("GET", "/v1/models?limit=1")
            .match_header("authorization", "Bearer sk-ant-secret")
            .match_header("anthropic-version", "2026-10-21")
            .with_status(200)
            .with_body(r#"{"data":[]}"#)
            .create_async()
            .await;
        client(&server).validate().await.unwrap();
        m.assert_async().await;

        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("GET", "/v1/models?limit=1")
            .with_status(401)
            .with_body("{}")
            .create_async()
            .await;
        assert_eq!(
            client(&server).validate().await.unwrap_err(),
            LlmError::Auth(Some(401))
        );
    }

    #[tokio::test]
    async fn empty_text_on_2xx_is_empty_error() {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/v1/messages")
            .with_status(200)
            .with_body(r#"{"stop_reason":"end_turn","content":[{"type":"thinking","thinking":"x"},{"type":"text","text":"  "}],"usage":{"input_tokens":1,"output_tokens":1}}"#)
            .create_async()
            .await;
        let err = client(&server)
            .complete(&req(Thinking::Disabled))
            .await
            .unwrap_err();
        assert_eq!(err, LlmError::Empty);
    }

    #[tokio::test]
    async fn key_is_trimmed() {
        let mut server = mockito::Server::new_async().await;
        let m = server
            .mock("POST", "/v1/messages")
            .match_header("authorization", "Bearer sk-ant-secret")
            .with_status(200)
            .with_body(r#"{"content":[{"type":"text","text":"ok"}]}"#)
            .create_async()
            .await;
        let c =
            ClaudeClient::new("  sk-ant-secret\n".into(), "m".into()).with_base_url(server.url());
        assert_eq!(
            c.complete(&req(Thinking::Disabled)).await.unwrap().text,
            "ok"
        );
        m.assert_async().await;
    }

    #[test]
    fn error_display_never_contains_key() {
        let errs = [
            LlmError::NoKey,
            LlmError::Auth(Some(401)),
            LlmError::RateLimited,
            LlmError::Refusal,
            LlmError::MaxTokens,
            LlmError::Timeout,
            LlmError::Empty,
            LlmError::BadFormat,
            LlmError::Network("connection reset".into()),
            LlmError::Api {
                status: 500,
                message: "boom".into(),
            },
        ];
        for e in errs {
            assert!(!e.to_string().contains("sk-ant"));
        }
    }

    /// Live smoke test; run with `UTTER_TEST_API_KEY=... cargo test --lib -- --ignored live_cleanup_smoke`.
    #[tokio::test]
    #[ignore]
    async fn live_cleanup_smoke() {
        use crate::llm::prompts::{cleanup_request, PromptContext};
        use crate::text::types::{Category, CleanupLevel, StyleKind};
        let key = std::env::var("UTTER_TEST_API_KEY").expect("set UTTER_TEST_API_KEY");
        let ctx = PromptContext {
            app_name: "Notepad".into(),
            category: Category::Other,
            style: StyleKind::Formal,
            level: CleanupLevel::Light,
            dictionary: vec![],
            user_name: String::new(),
        };
        let r = cleanup_request(&ctx, "um so i think uh we should go actually no lets stay");
        let c = ClaudeClient::new(key, "claude-haiku-5-5".into())
            .complete(&r)
            .await
            .unwrap();
        let out = crate::llm::output::extract_output(&c.text);
        assert!(!out.is_empty());
        assert!(!out
            .to_lowercase()
            .split_whitespace()
            .any(|w| w.trim_matches(|c: char| !c.is_alphanumeric()) == "um"));
    }
}
