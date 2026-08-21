use clap::{Parser, Subcommand};
use scopeshield::{load_contract, load_env_ast, validate};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "scopeshield", version, about = "Fail-fast environment validation proxy")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Validate process env (+ optional .env) against a contract YAML.
    Check {
        #[arg(long)]
        contract: PathBuf,
        #[arg(long)]
        env_file: Option<PathBuf>,
        #[arg(long)]
        skip_liveness: bool,
        #[arg(long, default_value_t = true)]
        json: bool,
        /// After a passing check, exec the remaining args (build intercept).
        #[arg(last = true)]
        run: Vec<String>,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Commands::Check {
            contract,
            env_file,
            skip_liveness,
            json,
            run,
        } => {
            let spec = match load_contract(&contract) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("{{\"ok\":false,\"reason\":\"{e}\"}}");
                    return ExitCode::from(1);
                }
            };
            let ast = load_env_ast(env_file.as_deref());
            let report = validate(&spec, &ast, skip_liveness);
            if json {
                println!("{}", serde_json::to_string(&report).unwrap());
            }
            if !report.ok {
                return ExitCode::from(1);
            }
            if let Some((cmd, args)) = run.split_first() {
                let status = std::process::Command::new(cmd).args(args).status();
                match status {
                    Ok(s) if s.success() => ExitCode::SUCCESS,
                    Ok(s) => ExitCode::from(s.code().unwrap_or(1) as u8),
                    Err(_) => ExitCode::from(1),
                }
            } else {
                ExitCode::SUCCESS
            }
        }
    }
}
