export type AudioFormat = "pcm16" | "pcm32f" | "opus" | "mp3" | "wav"

export interface AudioChunk {
  data: Float32Array | Int16Array
  sampleRate: number
  channels: number
  format: AudioFormat
  timestamp: number
  sequenceId: number
  isFinal: boolean
}

export interface TranscriptionChunk {
  text: string
  confidence: number
  timestamp: number
  sequenceId: number
  isFinal: boolean
  startTime: number
  endTime: number
}

export interface TTSSegment {
  audio: Float32Array
  sampleRate: number
  text: string
  timestamp: number
  sequenceId: number
  isFinal: boolean
}

export interface VoiceProfile {
  id: string
  name: string
  speakerId: string
  pitch: number
  speed: number
  emotion: string
  language: string
  sampleRate: number
}

export interface PipelineConfig {
  sampleRate: number
  channels: number
  chunkDuration: number
  vadThreshold: number
  vadSilenceDuration: number
  sttModel: string
  ttsModel: string
  maxLatency: number
  enableSpeculativeTTS: boolean
  enableInterrupt: boolean
  voiceProfile: VoiceProfile
}

export interface PipelineMetrics {
  totalAudioProcessed: number
  totalTranscriptions: number
  totalSynthesized: number
  avgSTTLatency: number
  avgTTSLatency: number
  avgEndToEndLatency: number
  interruptions: number
  droppedChunks: number
}

export type PipelineState =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "interrupted"
  | "error"

export interface PipelineEvent {
  type:
    | "speech_start"
    | "speech_end"
    | "transcription_partial"
    | "transcription_final"
    | "tts_start"
    | "tts_chunk"
    | "tts_complete"
    | "audio_playback_start"
    | "audio_playback_end"
    | "interrupt"
    | "error"
  timestamp: number
  data: unknown
}

export const defaultPipelineConfig: PipelineConfig = {
  sampleRate: 16000,
  channels: 1,
  chunkDuration: 20,
  vadThreshold: 0.5,
  vadSilenceDuration: 500,
  sttModel: "whisper-tiny",
  ttsModel: "kokoro-base",
  maxLatency: 200,
  enableSpeculativeTTS: true,
  enableInterrupt: true,
  voiceProfile: {
    id: "default",
    name: "Default NPC",
    speakerId: "speaker_0",
    pitch: 1.0,
    speed: 1.0,
    emotion: "neutral",
    language: "en",
    sampleRate: 24000,
  },
}
