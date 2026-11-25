//! Pure Insights computation over history stats (no clock, no system timezone).

use super::history::HistoryStat;
use crate::text::types::Category;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

const MS_PER_MIN: i64 = 60_000;
const MS_PER_HOUR: i64 = 3_600_000;
const MS_PER_DAY: i64 = 86_400_000;
/// Typing speed used for the "time saved" estimate.
const TYPING_WPM: f64 = 40.0;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppWords {
    pub name: String,
    pub words: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryWords {
    pub category: Category,
    pub words: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub total_words: u64,
    /// Words in the last 7 local calendar days (today included).
    pub week_words: u64,
    pub avg_wpm: u32,
    pub time_saved_min: u32,
    pub current_streak: u32,
    pub longest_streak: u32,
    /// `heatmap[weekday][hour]`, Monday = 0; each cell counts dictations.
    pub heatmap: [[u32; 24]; 7],
    pub top_apps: Vec<AppWords>,
    pub categories: Vec<CategoryWords>,
}

/// Local calendar day number (days since 1970-01-01 in the user's timezone).
fn local_day(ms: i64, tz_offset_min: i32) -> i64 {
    (ms + tz_offset_min as i64 * MS_PER_MIN).div_euclid(MS_PER_DAY)
}

/// `stats` order does not matter. `tz_offset_min` is local minus UTC in minutes.
///
/// - avg WPM: words / speaking minutes, over dictations of at least 1 s (shorter ones are noise).
/// - time saved: all words at 40 wpm typing minus all speaking minutes, never negative.
/// - streaks: consecutive local days with at least one dictation; the current streak
///   counts if the latest day is today or yesterday.
pub fn compute_insights(stats: &[HistoryStat], now_ms: i64, tz_offset_min: i32) -> Insights {
    let total_words: u64 = stats.iter().map(|s| s.words as u64).sum();
    let total_ms: i64 = stats.iter().map(|s| s.duration_ms.max(0)).sum();

    let (long_words, long_ms) = stats
        .iter()
        .filter(|s| s.duration_ms >= 1000)
        .fold((0u64, 0i64), |(w, d), s| {
            (w + s.words as u64, d + s.duration_ms)
        });
    let avg_wpm = if long_ms > 0 {
        (long_words as f64 / (long_ms as f64 / MS_PER_MIN as f64)).round() as u32
    } else {
        0
    };

    let speaking_min = total_ms as f64 / MS_PER_MIN as f64;
    let time_saved_min = (total_words as f64 / TYPING_WPM - speaking_min)
        .max(0.0)
        .round() as u32;

    let today = local_day(now_ms, tz_offset_min);
    let mut days = BTreeSet::new();
    let mut heatmap = [[0u32; 24]; 7];
    let mut week_words = 0u64;
    let mut apps: HashMap<&str, u64> = HashMap::new();
    let mut cats: HashMap<Category, u64> = HashMap::new();

    for s in stats {
        let local_ms = s.created_at + tz_offset_min as i64 * MS_PER_MIN;
        let day = local_ms.div_euclid(MS_PER_DAY);
        days.insert(day);
        // 1970-01-01 was a Thursday; Monday = 0.
        let weekday = (day + 3).rem_euclid(7) as usize;
        let hour = (local_ms.rem_euclid(MS_PER_DAY) / MS_PER_HOUR) as usize;
        heatmap[weekday][hour] += 1;
        if day > today - 7 && day <= today {
            week_words += s.words as u64;
        }
        if !s.app_name.is_empty() {
            *apps.entry(s.app_name.as_str()).or_default() += s.words as u64;
        }
        *cats.entry(s.category).or_default() += s.words as u64;
    }

    let mut longest_streak = 0u32;
    let mut run = 0u32;
    let mut prev: Option<i64> = None;
    for &d in &days {
        run = if prev == Some(d - 1) { run + 1 } else { 1 };
        longest_streak = longest_streak.max(run);
        prev = Some(d);
    }

    let mut current_streak = 0u32;
    let mut d = if days.contains(&today) {
        Some(today)
    } else if days.contains(&(today - 1)) {
        Some(today - 1)
    } else {
        None
    };
    while let Some(day) = d {
        if !days.contains(&day) {
            break;
        }
        current_streak += 1;
        d = Some(day - 1);
    }

    let mut top_apps: Vec<AppWords> = apps
        .into_iter()
        .map(|(name, words)| AppWords {
            name: name.to_string(),
            words,
        })
        .collect();
    top_apps.sort_by(|a, b| b.words.cmp(&a.words).then_with(|| a.name.cmp(&b.name)));
    top_apps.truncate(5);

    let mut categories: Vec<CategoryWords> = cats
        .into_iter()
        .map(|(category, words)| CategoryWords { category, words })
        .collect();
    categories.sort_by(|a, b| {
        b.words
            .cmp(&a.words)
            .then_with(|| format!("{:?}", a.category).cmp(&format!("{:?}", b.category)))
    });

    Insights {
        total_words,
        week_words,
        avg_wpm,
        time_saved_min,
        current_streak,
        longest_streak,
        heatmap,
        top_apps,
        categories,
    }
}

impl super::db::Db {
    /// Convenience: compute insights straight from the stored history.
    pub fn insights(&self, now_ms: i64, tz_offset_min: i32) -> Insights {
        compute_insights(&self.history_stats(), now_ms, tz_offset_min)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An arbitrary epoch day used as the fixture's first day.
    const D0: i64 = 20_000;

    fn at(day: i64, hour: i64, min: i64) -> i64 {
        day * MS_PER_DAY + hour * MS_PER_HOUR + min * MS_PER_MIN
    }

    fn stat(
        created_at: i64,
        app: &str,
        cat: Category,
        words: u32,
        duration_ms: i64,
    ) -> HistoryStat {
        HistoryStat {
            created_at,
            app_name: app.into(),
            category: cat,
            words,
            duration_ms,
        }
    }

    fn fixture() -> Vec<HistoryStat> {
        vec![
            // day D0: two dictations
            stat(at(D0, 9, 0), "Slack", Category::WorkChat, 60, 30_000),
            stat(at(D0, 9, 30), "Slack", Category::WorkChat, 40, 20_000),
            // day D0+1
            stat(at(D0 + 1, 14, 0), "Outlook", Category::Email, 100, 50_000),
            // day D0+2 (today)
            stat(at(D0 + 2, 9, 15), "Code", Category::Code, 20, 10_000),
            // too short to count for WPM
            stat(at(D0 + 2, 9, 20), "Code", Category::Code, 5, 500),
        ]
    }

    #[test]
    fn fixture_totals_wpm_and_time_saved() {
        let now = at(D0 + 2, 18, 0);
        let i = compute_insights(&fixture(), now, 0);
        assert_eq!(i.total_words, 225);
        // qualifying: 220 words over 110 s = 120 wpm
        assert_eq!(i.avg_wpm, 120);
        // 225/40 = 5.625 min typing; speaking = 110.5 s = 1.842 min -> 3.78 -> 4
        assert_eq!(i.time_saved_min, 4);
        assert_eq!(i.week_words, 225);
    }

    #[test]
    fn streaks_three_days_and_longest() {
        let now = at(D0 + 2, 18, 0);
        let i = compute_insights(&fixture(), now, 0);
        assert_eq!(i.current_streak, 3);
        assert_eq!(i.longest_streak, 3);

        // Gap: add an older isolated 2-day run and check longest vs current.
        let mut s = fixture();
        s.push(stat(at(D0 - 10, 8, 0), "x", Category::Other, 1, 1000));
        s.push(stat(at(D0 - 9, 8, 0), "x", Category::Other, 1, 1000));
        let i = compute_insights(&s, now, 0);
        assert_eq!((i.current_streak, i.longest_streak), (3, 3));

        // Today empty, yesterday present: streak still counts from yesterday.
        let now_next = at(D0 + 3, 8, 0);
        assert_eq!(compute_insights(&fixture(), now_next, 0).current_streak, 3);
        // Two days idle: streak broken.
        let now_later = at(D0 + 4, 8, 0);
        let i = compute_insights(&fixture(), now_later, 0);
        assert_eq!((i.current_streak, i.longest_streak), (0, 3));
    }

    #[test]
    fn heatmap_weekday_hour_cells() {
        let now = at(D0 + 2, 18, 0);
        let i = compute_insights(&fixture(), now, 0);
        let wd = |day: i64| ((day + 3).rem_euclid(7)) as usize;
        assert_eq!(i.heatmap[wd(D0)][9], 2);
        assert_eq!(i.heatmap[wd(D0 + 1)][14], 1);
        assert_eq!(i.heatmap[wd(D0 + 2)][9], 2);
        let total: u32 = i.heatmap.iter().flatten().sum();
        assert_eq!(total, 5);
        // 1970-01-01 (day 0) is a Thursday => index 3; day 4 is Monday => 0.
        let s = [stat(at(4, 0, 0), "a", Category::Other, 1, 1000)];
        assert_eq!(compute_insights(&s, at(4, 1, 0), 0).heatmap[0][0], 1);
    }

    #[test]
    fn timezone_offset_shifts_day_and_hour() {
        // 23:30 UTC on day 10 is 01:30 on day 11 at UTC+2.
        let s = [stat(at(10, 23, 30), "a", Category::Other, 10, 5000)];
        let i = compute_insights(&s, at(11, 12, 0), 120);
        let wd = ((11 + 3) % 7) as usize;
        assert_eq!(i.heatmap[wd][1], 1);
        assert_eq!(i.current_streak, 1);
        // Negative offset: 00:30 UTC day 11 is 19:30 day 10 at UTC-5.
        let s = [stat(at(11, 0, 30), "a", Category::Other, 10, 5000)];
        let i = compute_insights(&s, at(10, 23, 0) + 5 * MS_PER_HOUR, -300);
        assert_eq!(i.heatmap[((10 + 3) % 7) as usize][19], 1);
    }

    #[test]
    fn top_apps_limited_to_five_and_categories_sorted() {
        let mut s = Vec::new();
        for (i, app) in ["a", "b", "c", "d", "e", "f"].iter().enumerate() {
            s.push(stat(
                at(D0, 8, 0),
                app,
                Category::Other,
                10 * (i as u32 + 1),
                5000,
            ));
        }
        s.push(stat(at(D0, 8, 5), "a", Category::Email, 100, 5000));
        let i = compute_insights(&s, at(D0, 12, 0), 0);
        assert_eq!(i.top_apps.len(), 5);
        assert_eq!(
            i.top_apps[0],
            AppWords {
                name: "a".into(),
                words: 110
            }
        );
        assert_eq!(i.top_apps[1].name, "f");
        assert!(!i.top_apps.iter().any(|a| a.name == "b"));
        assert_eq!(
            i.categories[0],
            CategoryWords {
                category: Category::Other,
                words: 210
            }
        );
        assert_eq!(i.categories[1].category, Category::Email);
    }

    #[test]
    fn empty_and_edge_cases() {
        let i = compute_insights(&[], at(D0, 0, 0), 0);
        assert_eq!((i.total_words, i.avg_wpm, i.time_saved_min), (0, 0, 0));
        assert_eq!((i.current_streak, i.longest_streak), (0, 0));
        assert!(i.top_apps.is_empty() && i.categories.is_empty());
        // Slow speech never yields negative time saved.
        let s = [stat(at(D0, 1, 0), "a", Category::Other, 1, 600_000)];
        assert_eq!(compute_insights(&s, at(D0, 2, 0), 0).time_saved_min, 0);
        // Only sub-1s items: no WPM.
        let s = [stat(at(D0, 1, 0), "a", Category::Other, 3, 900)];
        assert_eq!(compute_insights(&s, at(D0, 2, 0), 0).avg_wpm, 0);
    }

    #[test]
    fn week_words_excludes_older_days() {
        let s = [
            stat(at(D0, 8, 0), "a", Category::Other, 10, 5000),
            stat(at(D0 - 7, 8, 0), "a", Category::Other, 99, 5000),
            stat(at(D0 - 6, 8, 0), "a", Category::Other, 1, 5000),
        ];
        assert_eq!(compute_insights(&s, at(D0, 12, 0), 0).week_words, 11);
    }

    #[test]
    fn serializes_camel_case() {
        let v = serde_json::to_value(compute_insights(&[], 0, 0)).unwrap();
        for k in [
            "totalWords",
            "weekWords",
            "avgWpm",
            "timeSavedMin",
            "currentStreak",
            "longestStreak",
            "heatmap",
            "topApps",
            "categories",
        ] {
            assert!(v.get(k).is_some(), "missing {k}");
        }
        assert_eq!(v["heatmap"].as_array().unwrap().len(), 7);
        assert_eq!(v["heatmap"][0].as_array().unwrap().len(), 24);
    }
}
