// The checks of a monitor with no screen, as they arrive (docs/SCOPE.md
// D457). An owner's browser works the checks out from the network (the
// monitor cannot: it has no document model) and sends them through the
// server as "plan" records, sealed with the site key like every record. One
// record holds at most what the server takes (128 KB), so a plan comes in
// parts:
//
//   { v: 1, monitor, by, rev, hash, i, n, networkName, items: [...] }
//
// `monitor` is whose plan it is, `by` who worked it out, `rev` when (unix
// ms, the same on every part of one plan), `hash` names the whole plan, `i`
// of `n` the part. A plan is taken when all its parts are here and it is
// newer than the one in use. Parts are kept on disk until then, because the
// link reads each record once.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::monitor::Item;

/// The most parts one plan may have (4000 items at a few hundred bytes).
pub const PARTS_MAX: usize = 64;

/// The plan in use: what the page sent, and which.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Kept {
    pub rev: i64,
    pub hash: String,
    pub by: String,
    pub network_name: String,
    pub items: Vec<Item>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct Pending {
    hash: String,
    network_name: String,
    n: usize,
    parts: BTreeMap<usize, Vec<Item>>,
}

/// The parts waiting for the rest of their plan: "by|rev" -> them.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Parts {
    waiting: BTreeMap<String, Pending>,
}

impl Parts {
    /// One part. -> the whole plan, when this part completed one newer than
    /// `have`. A part for another monitor, an older plan's or a malformed
    /// one is passed over.
    pub fn add(&mut self, me: &str, have: i64, v: &Value) -> Option<Kept> {
        if v["v"].as_i64() != Some(1) || v["monitor"].as_str() != Some(me) {
            return None;
        }
        let (rev, by) = (v["rev"].as_i64()?, v["by"].as_str().unwrap_or(""));
        let (i, n) = (v["i"].as_u64()? as usize, v["n"].as_u64()? as usize);
        if rev <= have || n == 0 || n > PARTS_MAX || i >= n || by.len() > 200 {
            return None;
        }
        let items: Vec<Item> = serde_json::from_value(v["items"].clone()).ok()?;
        let key = format!("{by}|{rev}");
        let p = self.waiting.entry(key.clone()).or_default();
        if p.n != 0 && p.n != n {
            // The same plan cannot have two sizes: start it again.
            *p = Pending::default();
        }
        p.n = n;
        p.hash = v["hash"].as_str().unwrap_or("").chars().take(64).collect();
        p.network_name = v["networkName"].as_str().unwrap_or("").chars().take(200).collect();
        p.parts.insert(i, items);
        if p.parts.len() < n {
            self.prune(have);
            return None;
        }
        let p = self.waiting.remove(&key)?;
        let kept = Kept { rev, hash: p.hash, by: by.to_string(), network_name: p.network_name, items: p.parts.into_values().flatten().collect() };
        self.prune(rev);
        Some(kept)
    }

    /// Parts of plans no newer than the one in use go, and all but the
    /// newest few plans still waiting.
    fn prune(&mut self, have: i64) {
        let rev_of = |k: &str| k.rsplit('|').next().and_then(|r| r.parse::<i64>().ok()).unwrap_or(0);
        self.waiting.retain(|k, _| rev_of(k) > have);
        while self.waiting.len() > 4 {
            let oldest = self.waiting.keys().min_by_key(|k| rev_of(k)).cloned();
            match oldest {
                Some(k) => self.waiting.remove(&k),
                None => break,
            };
        }
    }

    pub fn is_empty(&self) -> bool {
        self.waiting.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn part(monitor: &str, by: &str, rev: i64, i: usize, n: usize, keys: &[&str]) -> Value {
        let items: Vec<Value> = keys.iter().map(|k| json!({ "key": k, "nodeId": k.split('/').next().unwrap(), "name": k, "spec": { "proto": "ping", "host": "192.0.2.1" } })).collect();
        json!({ "v": 1, "monitor": monitor, "by": by, "rev": rev, "hash": format!("h{rev}"), "i": i, "n": n, "networkName": "Office", "items": items })
    }
    fn keys(k: &Kept) -> Vec<&str> {
        k.items.iter().map(|i| i.key.as_str()).collect()
    }

    #[test]
    fn a_plan_in_one_part_is_taken_at_once() {
        let mut p = Parts::default();
        let k = p.add("m1", 0, &part("m1", "u1", 10, 0, 1, &["a/1", "b/1"])).unwrap();
        assert_eq!((k.rev, k.hash.as_str(), k.by.as_str(), k.network_name.as_str(), keys(&k)), (10, "h10", "u1", "Office", vec!["a/1", "b/1"]));
        assert!(p.is_empty());
    }

    #[test]
    fn parts_wait_for_the_rest_and_join_in_order() {
        let mut p = Parts::default();
        assert!(p.add("m1", 0, &part("m1", "u1", 10, 2, 3, &["c/1"])).is_none());
        assert!(p.add("m1", 0, &part("m1", "u1", 10, 0, 3, &["a/1"])).is_none());
        // Kept on disk between the two: what is written reads back the same.
        let mut p: Parts = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        let k = p.add("m1", 0, &part("m1", "u1", 10, 1, 3, &["b/1"])).unwrap();
        assert_eq!(keys(&k), vec!["a/1", "b/1", "c/1"]);
        assert!(p.is_empty());
    }

    #[test]
    fn another_monitors_an_older_and_a_malformed_part_are_passed_over() {
        let mut p = Parts::default();
        assert!(p.add("m1", 0, &part("m2", "u1", 10, 0, 1, &["a/1"])).is_none());
        assert!(p.add("m1", 10, &part("m1", "u1", 10, 0, 1, &["a/1"])).is_none());
        assert!(p.add("m1", 10, &part("m1", "u1", 9, 0, 1, &["a/1"])).is_none());
        assert!(p.add("m1", 0, &part("m1", "u1", 10, 3, 3, &["a/1"])).is_none());
        assert!(p.add("m1", 0, &part("m1", "u1", 10, 0, 0, &["a/1"])).is_none());
        assert!(p.add("m1", 0, &part("m1", "u1", 10, 0, PARTS_MAX + 1, &["a/1"])).is_none());
        let mut bad = part("m1", "u1", 10, 0, 1, &["a/1"]);
        bad["items"] = json!("no");
        assert!(p.add("m1", 0, &bad).is_none());
        bad = part("m1", "u1", 10, 0, 1, &["a/1"]);
        bad["v"] = json!(2);
        assert!(p.add("m1", 0, &bad).is_none());
        assert!(p.is_empty());
    }

    #[test]
    fn two_owners_plans_do_not_mix_and_the_newer_whole_one_wins() {
        let mut p = Parts::default();
        assert!(p.add("m1", 0, &part("m1", "u1", 10, 0, 2, &["a/1"])).is_none());
        assert!(p.add("m1", 0, &part("m1", "u2", 12, 1, 2, &["z/1"])).is_none());
        let k = p.add("m1", 0, &part("m1", "u2", 12, 0, 2, &["y/1"])).unwrap();
        assert_eq!((k.by.as_str(), keys(&k)), ("u2", vec!["y/1", "z/1"]));
        // The older plan's waiting part went with it.
        assert!(p.is_empty());
        assert!(p.add("m1", 12, &part("m1", "u1", 10, 1, 2, &["b/1"])).is_none());
    }

    #[test]
    fn a_plan_with_no_check_is_a_plan() {
        let mut p = Parts::default();
        let k = p.add("m1", 5, &part("m1", "u1", 10, 0, 1, &[])).unwrap();
        assert!(k.items.is_empty() && k.rev == 10);
    }

    #[test]
    fn plans_that_never_complete_do_not_pile_up() {
        let mut p = Parts::default();
        for rev in 1..=20 {
            assert!(p.add("m1", 0, &part("m1", "u1", rev, 0, 2, &["a/1"])).is_none());
        }
        assert!(p.waiting.len() <= 4);
        assert!(p.waiting.contains_key("u1|20"));
    }
}
