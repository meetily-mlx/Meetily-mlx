// audio/transcription/provider.rs
//
// Defines the unified TranscriptionProvider trait and common types for all
// transcription engines (Whisper, Parakeet, future providers).

use async_trait::async_trait;

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
                .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;
            
            for &sample in &audio {
                // Scale f32 sample [-1.0, 1.0] to i16 boundaries
                let scaled = (sample * i16::MAX as f32) as i16;
                writer.write_sample(scaled)
                    .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;
            }
            writer.finalize().map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;
        }

        // 2. Build the HTTP Multi-part Request
        let client = reqwest::Client::new();
        let audio_part = reqwest::multipart::Part::bytes(wav_bytes)
            .file_name("chunk.wav")
            .mime_str("audio/wav")
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;
            
        let form = reqwest::multipart::Form::new().part("file", audio_part);

        // 3. Post to the MLX server
        let response = client.post(&format!("{}/audio/transcriptions", self.endpoint))
            .header("Authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
            .send()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?
            .json::<serde_json::Value>()
            .await
            .map_err(|e| TranscriptionError::EngineFailed(e.to_string()))?;

        // 4. Extract text
        let transcribed_text = response["text"]
            .as_str()
            .unwrap_or("")
            .to_string();

        // 5. Build native TranscriptResult structure
        Ok(TranscriptResult {
            text: transcribed_text,
            confidence: None,
            is_partial: false,
        })
    }

    async fn is_model_loaded(&self) -> bool {
        true // Handled by your external MLX server
    }

    async fn get_current_model(&self) -> Option<String> {
        Some("mlx-qwen3-asr".to_string())
    }

    fn provider_name(&self) -> &'static str {
        "Qwen3RemoteProvider"
    }
}