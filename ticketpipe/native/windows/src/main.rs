#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
mod desktop;

#[cfg(windows)]
fn main() {
    use serde_json::{json, Value};
    use std::io::{BufRead, Write};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    };
    let revoked = Arc::new(AtomicBool::new(false));
    let output = Arc::new(Mutex::new(std::io::stdout()));
    let (tx, rx) = mpsc::channel::<Value>();
    let flag = revoked.clone();
    let out = output.clone();
    std::thread::spawn(move || {
        let mut controller = match desktop::Desktop::new(flag.clone()) {
            Ok(v) => v,
            Err(_) => return,
        };
        for request in rx {
            let result = controller.execute(&request);
            let reply = match result {
                Ok(value) => json!({"id":request["id"],"ok":true,"result":value}),
                Err(error) => json!({"id":request["id"],"ok":false,"error":error}),
            };
            if let Ok(mut writer) = out.lock() {
                let _ = writeln!(writer, "{}", reply);
                let _ = writer.flush();
            }
        }
    });
    // Cancellation has its own reader thread; a stalled UIA provider cannot queue more inputs.
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.len() > 65536 {
            break;
        }
        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            break;
        };
        if request["op"] == "cancel" {
            revoked.store(true, Ordering::SeqCst);
            if let Ok(mut writer) = output.lock() {
                let _ = writeln!(
                    writer,
                    "{}",
                    json!({"id":request["id"],"ok":true,"result":{}})
                );
                let _ = writer.flush();
            }
        } else if tx.send(request).is_err() {
            break;
        }
    }
    revoked.store(true, Ordering::SeqCst);
    std::process::exit(0);
}

#[cfg(not(windows))]
fn main() {
    eprintln!("Automatic desktop fixing is available on Windows only.");
}
