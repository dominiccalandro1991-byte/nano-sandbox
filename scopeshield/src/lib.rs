//! ScopeShield — fail-fast environment validation. Not an NHSE engine.
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::time::Instant;

#[derive(Debug, Clone, Deserialize)]
pub struct Contract {
    pub service: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub variables: Vec<Variable>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Variable {
    pub name: String,
    #[serde(rename = "type", default = "default_type")]
    pub kind: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub regex: Option<String>,
    #[serde(default)]
    pub min_length: Option<usize>,
    #[serde(default)]
    pub forbid: Vec<String>,
    #[serde(default)]
    pub liveness: Option<Liveness>,
    #[serde(default)]
    pub notes: Option<String>,
}

fn default_type() -> String {
    "string".into()
}

#[derive(Debug, Clone, Deserialize)]
pub struct Liveness {
    #[serde(default = "default_method")]
    pub method: String,
    pub url: String,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub bearer_env: Option<String>,
}

fn default_method() -> String {
    "HEAD".into()
}
fn default_timeout() -> u64 {
    4000
}

#[derive(Debug, Clone, Serialize)]
pub struct Failure {
    pub name: String,
    pub reason: String,
    pub constraint: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Report {
    pub ok: bool,
    pub service: String,
    pub elapsed_ms: u128,
    pub checks: usize,
    pub failures: Vec<Failure>,
    pub liveness: Vec<LivenessResult>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LivenessResult {
    pub name: String,
    pub url: String,
    pub ok: bool,
    pub status: Option<u16>,
    pub reason: String,
}

pub fn parse_dotenv(text: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line);
        let Some((k, v)) = line.split_once('=') else { continue };
        let key = k.trim();
        if key.is_empty() {
            continue;
        }
        let mut val = v.trim().to_string();
        if (val.starts_with('"') && val.ends_with('"')) || (val.starts_with('\'') && val.ends_with('\''))
        {
            val = val[1..val.len() - 1].to_string();
        }
        out.insert(key.to_string(), val);
    }
    out
}

pub fn load_env_ast(env_file: Option<&Path>) -> BTreeMap<String, String> {
    let mut ast = BTreeMap::new();
    if let Some(path) = env_file {
        if let Ok(text) = fs::read_to_string(path) {
            ast.extend(parse_dotenv(&text));
        }
    }
    for (k, v) in std::env::vars() {
        ast.insert(k, v);
    }
    ast
}

pub fn load_contract(path: &Path) -> Result<Contract, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("contract_unreadable:{e}"))?;
    serde_yaml::from_str(&text).map_err(|e| format!("contract_invalid:{e}"))
}

fn type_ok(kind: &str, value: &str) -> Result<(), String> {
    match kind {
        "string" => Ok(()),
        "url" => {
            if value.starts_with("http://") || value.starts_with("https://") {
                Ok(())
            } else {
                Err("type:url".into())
            }
        }
        "https_url" => {
            if value.starts_with("https://") {
                Ok(())
            } else {
                Err("type:https_url".into())
            }
        }
        "postgres_url" => {
            let v = value.to_ascii_lowercase();
            if v.starts_with("sqlite:")
                || v.starts_with("postgres://")
                || v.starts_with("postgresql://")
                || v.starts_with("postgresql+psycopg://")
            {
                Ok(())
            } else {
                Err("type:postgres_url".into())
            }
        }
        "hex" => {
            if !value.is_empty() && value.chars().all(|c| c.is_ascii_hexdigit()) {
                Ok(())
            } else {
                Err("type:hex".into())
            }
        }
        "jwt" => {
            let parts: Vec<&str> = value.split('.').collect();
            if value.starts_with("eyJ") && parts.len() == 3 && parts.iter().all(|p| !p.is_empty()) {
                Ok(())
            } else {
                Err("type:jwt".into())
            }
        }
        other => Err(format!("unknown_type:{other}")),
    }
}

fn ping(live: &Liveness, ast: &BTreeMap<String, String>) -> LivenessResult {
    let mut req = match live.method.to_ascii_uppercase().as_str() {
        "GET" => ureq::get(&live.url),
        _ => ureq::head(&live.url),
    };
    if let Some(env_name) = live.bearer_env.as_deref() {
        if let Some(token) = ast.get(env_name).filter(|s| !s.is_empty()) {
            req = req.set("Authorization", &format!("Bearer {token}"));
        }
    }
    let timeout = u64::max(1, live.timeout_ms);
    req = req.timeout(std::time::Duration::from_millis(timeout));
    match req.call() {
        Ok(resp) => {
            let status = resp.status();
            let ok = (200..400).contains(&status) || status == 403;
            LivenessResult {
                name: live.url.clone(),
                url: live.url.clone(),
                ok,
                status: Some(status),
                reason: if ok {
                    "ok".into()
                } else {
                    format!("http_{status}")
                },
            }
        }
        Err(ureq::Error::Status(code, _)) => LivenessResult {
            name: live.url.clone(),
            url: live.url.clone(),
            ok: false,
            status: Some(code),
            reason: format!("http_{code}"),
        },
        Err(_) => LivenessResult {
            name: live.url.clone(),
            url: live.url.clone(),
            ok: false,
            status: None,
            reason: "unreachable".into(),
        },
    }
}

pub fn validate(contract: &Contract, ast: &BTreeMap<String, String>, skip_liveness: bool) -> Report {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut liveness = Vec::new();
    let mut checks = 0usize;

    for var in &contract.variables {
        checks += 1;
        let present = ast.get(&var.name).map(|s| s.as_str()).unwrap_or("");
        if present.is_empty() {
            if var.required {
                failures.push(Failure {
                    name: var.name.clone(),
                    reason: "missing".into(),
                    constraint: "required".into(),
                });
            }
            continue;
        }
        if let Some(min) = var.min_length {
            if present.chars().count() < min {
                failures.push(Failure {
                    name: var.name.clone(),
                    reason: "too_short".into(),
                    constraint: format!("min_length:{min}"),
                });
            }
        }
        if let Err(constraint) = type_ok(&var.kind, present) {
            failures.push(Failure {
                name: var.name.clone(),
                reason: "type".into(),
                constraint,
            });
        }
        if let Some(pat) = var.regex.as_deref() {
            match Regex::new(pat) {
                Ok(re) => {
                    if !re.is_match(present) {
                        failures.push(Failure {
                            name: var.name.clone(),
                            reason: "regex".into(),
                            constraint: pat.to_string(),
                        });
                    }
                }
                Err(_) => failures.push(Failure {
                    name: var.name.clone(),
                    reason: "bad_regex".into(),
                    constraint: pat.to_string(),
                }),
            }
        }
        let lowered = present.to_ascii_lowercase();
        for needle in &var.forbid {
            if !needle.is_empty() && lowered.contains(&needle.to_ascii_lowercase()) {
                failures.push(Failure {
                    name: var.name.clone(),
                    reason: "forbidden_substring".into(),
                    constraint: needle.clone(),
                });
            }
        }
        if !skip_liveness {
            if let Some(live) = &var.liveness {
                let result = ping(live, ast);
                if !result.ok {
                    failures.push(Failure {
                        name: var.name.clone(),
                        reason: "liveness".into(),
                        constraint: result.reason.clone(),
                    });
                }
                liveness.push(result);
            }
        }
    }

    Report {
        ok: failures.is_empty(),
        service: contract.service.clone(),
        elapsed_ms: started.elapsed().as_millis(),
        checks,
        failures,
        liveness,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn contracts_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("contracts")
    }

    #[test]
    fn ci_contract_passes_with_fixture_env() {
        let c = load_contract(&contracts_dir().join("ci.yaml")).unwrap();
        let mut ast = BTreeMap::new();
        ast.insert("SCOPESHIELD_CI".into(), "ok".into());
        let r = validate(&c, &ast, true);
        assert!(r.ok, "{:?}", r.failures);
        assert!(r.elapsed_ms < 50);
    }

    #[test]
    fn ci_contract_fails_when_missing() {
        let c = load_contract(&contracts_dir().join("ci.yaml")).unwrap();
        let r = validate(&c, &BTreeMap::new(), true);
        assert!(!r.ok);
        assert_eq!(r.failures[0].reason, "missing");
    }

    #[test]
    fn forbids_dead_supabase_ref_on_nano_sandbox() {
        let c = load_contract(&contracts_dir().join("nano-sandbox.yaml")).unwrap();
        let mut ast = BTreeMap::new();
        ast.insert(
            "NANO_SANDBOX_DATABASE_URL".into(),
            "postgresql://postgres.hlwqtlrkwhuogcwnhjrs:x@host/postgres".into(),
        );
        let r = validate(&c, &ast, true);
        assert!(!r.ok);
        assert!(r.failures.iter().any(|f| f.reason == "forbidden_substring"));
    }

    #[test]
    fn forbids_sujvxx_on_causalrail_db() {
        let c = load_contract(&contracts_dir().join("causalrail.yaml")).unwrap();
        let mut ast = BTreeMap::new();
        ast.insert(
            "DATABASE_URL".into(),
            "postgresql://postgres.sujvxxrwjqsziswuazwm:x@host/postgres".into(),
        );
        ast.insert("GITHUB_WEBHOOK_SECRET".into(), "long-enough-secret".into());
        let r = validate(&c, &ast, true);
        assert!(r.failures.iter().any(|f| f.reason == "forbidden_substring"));
    }

    #[test]
    fn jwt_and_https_types() {
        assert!(type_ok("jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig").is_ok());
        assert!(type_ok("jwt", "not-a-jwt").is_err());
        assert!(type_ok("https_url", "https://example.com/x").is_ok());
        assert!(type_ok("https_url", "http://insecure.example").is_err());
    }

    #[test]
    fn dotenv_ast_does_not_print_values() {
        let ast = parse_dotenv("FOO=secret-value\n# c\nBAR=\"x\"\n");
        assert_eq!(ast.get("FOO").unwrap(), "secret-value");
        let json = serde_json::to_string(&ast).unwrap();
        let c = Contract {
            service: "t".into(),
            description: "".into(),
            variables: vec![Variable {
                name: "FOO".into(),
                kind: "string".into(),
                required: true,
                regex: None,
                min_length: None,
                forbid: vec![],
                liveness: None,
                notes: None,
            }],
        };
        let r = validate(&c, &ast, true);
        let out = serde_json::to_string(&r).unwrap();
        assert!(!out.contains("secret-value"), "{out}");
        let _ = json;
    }
}
