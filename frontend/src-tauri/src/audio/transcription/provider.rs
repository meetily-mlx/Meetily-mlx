// audio/transcription/provider.rs
//
// Defines the unified TranscriptionProvider trait and common types for all
// transcription engines (Whisper, Parakeet, future providers).

use async_trait::async_trait;
use log::{info, warn, error};

// ============================================================================
// TRANSCRIPTION PROVIDER TRAIT & ERROR TYPES
// ============================================================================

/// Granular error types for transcription operations
#[derive(Debug, Clone)]
pub enum TranscriptionError {
    ModelNotLoaded,
    AudioTooShort { samples: usize, minimum: usize },
    EngineFailed(String),
    UnsupportedLanguage(String),
}

impl std::fmt::Display for TranscriptionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ModelNotLoaded => write!(f, "No transcription model is loaded"),
            Self::AudioTooShort { samples, minimum } => write!(
                f,
                "Audio too short: {} samples (minimum {})",
                samples, minimum
            ),
            Self::EngineFailed(msg) => write!(f, "Transcription engine failed: {}", msg),
            Self::UnsupportedLanguage(lang) => {
                write!(f, "Language '{}' is not supported by this provider", lang)
            }
        }
    }
}

impl std::error::Error for TranscriptionError {}

/// Unified transcription result across all providers
#[derive(Debug, Clone)]
pub struct TranscriptResult {
    pub text: String,
    pub confidence: Option<f32>, // None if provider doesn't support confidence scores
    pub is_partial: bool,
}

/// Trait for transcription providers (Whisper, Parakeet, future providers)
#[async_trait]
pub trait TranscriptionProvider: Send + Sync {
    /// Transcribe audio samples to text
    ///
    /// # Arguments
    /// * `audio` - Audio samples (16kHz mono, f32 format)
    /// * `language` - Optional language hint (e.g., "en", "es", "fr")
    ///
    /// # Returns
    /// * `TranscriptResult` with text, optional confidence, and partial flag
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError>;

    /// Check if a model is currently loaded
    async fn is_model_loaded(&self) -> bool;

    /// Get the name of the currently loaded model
    async fn get_current_model(&self) -> Option<String>;

    /// Get the provider name (for logging/debugging)
    fn provider_name(&self) -> &'static str;
}


// use crate::audio::transcription::{TranscriptionProvider, TranscriptResult}; 

// CUSTOM QWEN3 REMOTE PROVIDER IMPLEMENTATION
pub struct Qwen3RemoteProvider {
    pub endpoint: String,
    pub api_key: String,
}

#[async_trait]
impl TranscriptionProvider for Qwen3RemoteProvider {
    async fn transcribe(
        &self,
        audio: Vec<f32>,
        _language: Option<String>,
    ) -> std::result::Result<TranscriptResult, TranscriptionError> {
        
        info!("🔊 Qwen3: Transcribing {} audio samples", audio.len());
        
        // Skip if audio is too short
        if audio.len() < 1600 { // 100ms at 16kHz
            return Err(TranscriptionError::AudioTooShort {
                samples: audio.len(),
                minimum: 1600,
            });
        }

        // 1. Convert the f32 audio samples into standard 16-bit PCM WAV bytes
        let mut wav_bytes = Vec::new();
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        
        {
            let mut writer = hound::WavWriter::new(std::io::Cursor::new(&mut wav_bytes), spec)
                .map_err(|e| TranscriptionError::EngineFailed(format!("WAV writer error: {}", e)))?;
            
            for &sample in &audio {
                let clamped = sample.clamp(-1.0, 1.0);
                let scaled = (clamped * i16::MAX as f32) as i16;
                writer.write_sample(scaled)
                    .map_err(|e| TranscriptionError::EngineFailed(format!("WAV write error: {}", e)))?;
            }
            writer.finalize().map_err(|e| TranscriptionError::EngineFailed(format!("WAV finalize error: {}", e)))?;
        }

        info!("📤 Qwen3: Created WAV file ({} bytes)", wav_bytes.len());

        // 2. Build the HTTP Multipart Request
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| TranscriptionError::EngineFailed(format!("HTTP client error: {}", e)))?;
            
        let audio_part = reqwest::multipart::Part::bytes(wav_bytes)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| TranscriptionError::EngineFailed(format!("Multipart error: {}", e)))?;
            
        let form = reqwest::multipart::Form::new().part("file", audio_part);

        // 3. MLX Qwen3 uses /transcribe endpoint
        let base_endpoint = self.endpoint.trim_end_matches('/');
        let url = format!("{}/transcribe", base_endpoint);
        
        info!("📤 Qwen3: Sending request to: {}", url);
        
        let response = client.post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
            .send()
            .await
            .map_err(|e| {
                let msg = format!("Request to Qwen3 server failed: {}", e);
                error!("❌ Qwen3: {}", msg);
                
                // Provide helpful error messages
                if e.is_connect() {
                    TranscriptionError::EngineFailed(
                        format!("Cannot connect to Qwen3 server at {}. Make sure it's running with: mlx-qwen3-asr serve --api-key {} --port 8765", 
                            self.endpoint, self.api_key)
                    )
                } else if e.is_timeout() {
                    TranscriptionError::EngineFailed(
                        "Qwen3 server request timed out. The server might be busy.".to_string()
                    )
                } else {
                    TranscriptionError::EngineFailed(msg)
                }
            })?;

        let status = response.status();
        info!("📥 Qwen3: Response status: {}", status);

        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            let msg = format!("Qwen3 server error {}: {}", status, error_text);
            error!("❌ Qwen3: {}", msg);
            return Err(TranscriptionError::EngineFailed(msg));
        }

        // Parse the response
        let json_response = response
            .json::<serde_json::Value>()
            .await
            .map_err(|e| {
                let msg = format!("Failed to parse Qwen3 response: {}", e);
                error!("❌ Qwen3: {}", msg);
                TranscriptionError::EngineFailed(msg)
            })?;

        info!("📥 Qwen3: Response: {}", json_response);

        // Extract text - MLX Qwen3 returns { "text": "..." }
        let transcribed_text = if let Some(text) = json_response["text"].as_str() {
            text.to_string()
        } else if let Some(text) = json_response["result"].as_str() {
            text.to_string()
        } else if let Some(text) = json_response["transcription"].as_str() {
            text.to_string()
        } else {
            warn!("⚠️ Qwen3: Unexpected response format: {}", json_response);
            return Err(TranscriptionError::EngineFailed(
                format!("Unexpected response format: missing 'text' field. Got: {}", json_response)
            ));
        };

        info!("✅ Qwen3: Transcription: '{}'", transcribed_text);

        Ok(TranscriptResult {
            text: transcribed_text,
            confidence: None,
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        // Check if server is reachable
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .unwrap_or_default();
        
        let base_endpoint = self.endpoint.trim_end_matches('/');
        
        // Try multiple endpoints
        let endpoints = vec![
            base_endpoint.to_string(),
            format!("{}/", base_endpoint),
            format!("{}/transcribe", base_endpoint),
        ];
        
        for url in endpoints {
            match client.get(&url).send().await {
                Ok(response) => {
                    let status = response.status();
                    // Any of these statuses means the server is alive
                    if status.is_success() || status == 404 || status == 405 || status == 400 {
                        info!("✅ Qwen3 server reachable at {} (status: {})", url, status);
                        return true;
                    }
                }
                Err(_) => continue,
            }
        }
        
        warn!("❌ Qwen3 server not reachable at {}", self.endpoint);
        false
    }

    async fn get_current_model(&self) -> Option<String> {
        Some("Qwen/Qwen3-ASR-0.6B".to_string())
    }

    fn provider_name(&self) -> &'static str {
        "Qwen3RemoteProvider"
    }
}

// Add to Qwen3RemoteProvider impl
pub async fn transcribe_stream(
    audio_chunks: Vec<Vec<f32>>,
    provider: &Qwen3RemoteProvider,  // Pass provider as parameter
) -> Result<Vec<TranscriptResult>, TranscriptionError> {
    let mut results = Vec::new();
    for chunk in audio_chunks {
        let result = provider.transcribe(chunk, None).await?;
        results.push(result);
    }
    Ok(results)
}
