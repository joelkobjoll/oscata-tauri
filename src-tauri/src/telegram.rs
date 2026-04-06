/// Send a message to a Telegram channel/chat via a bot.
///
/// `token`   — bot token from @BotFather (e.g. `123456:ABCdef...`)
/// `chat_id` — channel username (e.g. `@mychannel`) or numeric chat id
/// `text`    — message body (plain text, up to 4096 chars)
pub async fn send_message(token: &str, chat_id: &str, text: &str) -> Result<(), String> {
    if token.is_empty() || chat_id.is_empty() {
        return Err("Telegram token and chat_id must not be empty".to_string());
    }

    let url = format!("https://api.telegram.org/bot{token}/sendMessage");
    let body = serde_json::json!({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Telegram request failed: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body_text = response.text().await.unwrap_or_default();
        return Err(format!("Telegram returned {status}: {body_text}"));
    }

    Ok(())
}

/// Calls `getUpdates` on the given bot token and returns the chat_id of the most
/// recent message sender. Returns `None` if no messages have been received yet.
/// The caller should instruct the user to send any message to their bot first.
pub async fn get_updates_first_chat_id(token: &str) -> Result<Option<String>, String> {
    if token.is_empty() {
        return Err("Token de bot vacío".to_string());
    }

    let url = format!("https://api.telegram.org/bot{token}/getUpdates?limit=1&offset=-1");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Error al contactar con Telegram: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Token de bot inválido (HTTP {status}): {body}"));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    if !json["ok"].as_bool().unwrap_or(false) {
        let desc = json["description"].as_str().unwrap_or("error desconocido");
        return Err(format!("Token de bot inválido: {desc}"));
    }

    let chat_id = json["result"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|upd| {
            upd["message"]["chat"]["id"]
                .as_i64()
                .map(|id| id.to_string())
                .or_else(|| {
                    upd["edited_message"]["chat"]["id"]
                        .as_i64()
                        .map(|id| id.to_string())
                })
        });

    Ok(chat_id)
}

/// Sends a photo to a Telegram channel/chat via a bot.
/// `photo_url` must be a publicly accessible HTTPS URL.
/// Falls back to a plain text message if the photo send fails.
pub async fn send_photo(token: &str, chat_id: &str, photo_url: &str, caption: &str) -> Result<(), String> {
    if token.is_empty() || chat_id.is_empty() {
        return Err("Telegram token and chat_id must not be empty".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("https://api.telegram.org/bot{token}/sendPhoto");
    let body = serde_json::json!({
        "chat_id": chat_id,
        "photo": photo_url,
        "caption": caption,
        "parse_mode": "HTML",
    });

    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Telegram photo request failed: {e}"))?;

    if !response.status().is_success() {
        // Fall back to plain text
        return send_message(token, chat_id, caption).await;
    }

    Ok(())
}
