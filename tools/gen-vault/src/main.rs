//! `gen-vault --seed <n> --out <dir> [--notes N] [--images N] [--tags N] [--small-images] [--digest]`
//! Generates the reference vault (performance.md). Defaults = the reference vault.
use std::path::PathBuf;
use std::process::exit;

fn main() {
    let mut args = std::env::args().skip(1);
    let mut o = gen_vault::Options::reference(1);
    let mut out: Option<PathBuf> = None;
    let mut digest = false;
    while let Some(a) = args.next() {
        let mut num = |name: &str| -> u64 {
            args.next().and_then(|v| v.parse().ok()).unwrap_or_else(|| {
                eprintln!("{name} needs a number");
                exit(2)
            })
        };
        match a.as_str() {
            "--seed" => o.seed = num("--seed"),
            "--notes" => o.notes = num("--notes") as usize,
            "--images" => o.images = num("--images") as usize,
            "--tags" => o.tags = num("--tags") as usize,
            "--small-images" => o.full_images = false,
            "--digest" => digest = true,
            "--out" => out = args.next().map(PathBuf::from),
            _ => {
                eprintln!("usage: gen-vault --seed <n> --out <dir> [--notes N] [--images N] [--tags N] [--small-images] [--digest]");
                exit(2)
            }
        }
    }
    let Some(out) = out else {
        eprintln!("--out <dir> is required");
        exit(2)
    };
    if out.exists() && std::fs::read_dir(&out).map(|mut d| d.next().is_some()).unwrap_or(true) {
        eprintln!("{} is not empty; refusing to write into it", out.display());
        exit(1)
    }
    let t = std::time::Instant::now();
    let n = gen_vault::generate(&out, &o).unwrap_or_else(|e| {
        eprintln!("error: {e}");
        exit(1)
    });
    eprintln!("{n} files in {:.1} s → {}", t.elapsed().as_secs_f64(), out.display());
    if digest {
        println!("{:016x}", gen_vault::tree_digest(&out).unwrap());
    }
}
