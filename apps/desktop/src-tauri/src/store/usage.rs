//! Claude token usage per day/model and the monthly cost estimate.

use super::db::Db;
use anyhow::Result;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub month_input_tokens: u64,
    pub month_output_tokens: u64,
    pub est_cost_usd: f64,
}

/// USD per million tokens (input, output).
fn price_per_million(model: &str) -> (f64, f64) {
    if model.contains("sonnet") {
        (2.00, 10.00)
    } else {
        // Haiku 5.5, and the fallback for unknown models.
        (0.10, 0.50)
    }
}

impl Db {
    /// Add tokens to the (day, model) counter. `day` is `YYYY-MM-DD`.
    pub fn add_usage(&self, day: &str, model: &str, input: u32, output: u32) -> Result<()> {
        self.conn().execute(
            "INSERT INTO usage (day, model, input_tokens, output_tokens) VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(day, model) DO UPDATE SET \
               input_tokens = input_tokens + excluded.input_tokens, \
               output_tokens = output_tokens + excluded.output_tokens",
            params![day, model, input, output],
        )?;
        Ok(())
    }

    /// Totals for days starting with `month_prefix` (`YYYY-MM`).
    pub fn usage_for_month(&self, month_prefix: &str) -> Usage {
        let conn = self.conn();
        let mut usage = Usage {
            month_input_tokens: 0,
            month_output_tokens: 0,
            est_cost_usd: 0.0,
        };
        let result = (|| -> rusqlite::Result<()> {
            let mut st = conn.prepare(
                "SELECT model, SUM(input_tokens), SUM(output_tokens) FROM usage \
                 WHERE substr(day, 1, ?2) = ?1 GROUP BY model",
            )?;
            let prefix_len = month_prefix.chars().count() as i64;
            let rows = st.query_map(params![month_prefix, prefix_len], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?;
            for row in rows {
                let (model, input, output) = row?;
                let (pi, po) = price_per_million(&model);
                usage.month_input_tokens += input as u64;
                usage.month_output_tokens += output as u64;
                usage.est_cost_usd += input as f64 / 1e6 * pi + output as f64 / 1e6 * po;
            }
            Ok(())
        })();
        if let Err(e) = result {
            log::error!("usage query failed: {e}");
        }
        usage.est_cost_usd = (usage.est_cost_usd * 1e6).round() / 1e6;
        usage
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haiku_million_in_million_out_costs_sixty_cents() {
        let db = Db::open_in_memory().unwrap();
        db.add_usage("2026-11-24", "claude-haiku-5-5", 1_000_000, 1_000_000)
            .unwrap();
        let u = db.usage_for_month("2026-11");
        assert_eq!(u.month_input_tokens, 1_000_000);
        assert_eq!(u.month_output_tokens, 1_000_000);
        assert!((u.est_cost_usd - 0.60).abs() < 1e-9, "{}", u.est_cost_usd);
    }

    #[test]
    fn sonnet_pricing_accumulation_and_month_filter() {
        let db = Db::open_in_memory().unwrap();
        db.add_usage("2026-11-01", "claude-sonnet-5-5", 500_000, 100_000)
            .unwrap();
        db.add_usage("2026-11-01", "claude-sonnet-5-5", 500_000, 100_000)
            .unwrap();
        db.add_usage("2026-10-31", "claude-sonnet-5-5", 9_000_000, 9_000_000)
            .unwrap();
        let u = db.usage_for_month("2026-11");
        assert_eq!(u.month_input_tokens, 1_000_000);
        assert_eq!(u.month_output_tokens, 200_000);
        assert!((u.est_cost_usd - 4.0).abs() < 1e-9, "{}", u.est_cost_usd);
        let empty = db.usage_for_month("2027-01");
        assert_eq!((empty.month_input_tokens, empty.est_cost_usd), (0, 0.0));
    }

    #[test]
    fn serializes_camel_case() {
        let v = serde_json::to_value(Usage {
            month_input_tokens: 1,
            month_output_tokens: 2,
            est_cost_usd: 0.5,
        })
        .unwrap();
        assert_eq!(v["monthInputTokens"], 1);
        assert_eq!(v["estCostUsd"], 0.5);
    }
}
