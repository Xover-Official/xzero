import { Effect, Context, Layer, Ref, Queue, Stream, Schedule } from "effect"
import type { AudioChunk, TranscriptionChunk } from "../types.js"

export class STTEngine extends Context.Tag("xzero/audio/STT")<
  STTEngine,
  {
    readonly transcribeChunk: (chunk: AudioChunk) => Effect.Effect<TranscriptionChunk>
    readonly transcribeStream: (
      chunks: Stream.Stream<AudioChunk>
    ) => Effect.Effect<Stream.Stream<TranscriptionChunk>>
    readonly getPartialTranscription: () => Effect.Effect<string>
    readonly reset: () => Effect.Effect<void>
  }
>() {}

interface STTState {
  buffer: Float32Array
  partialText: string
  sequenceId: number
  isProcessing: boolean
}

export const makeSTTEngine = (model: string, sampleRate: number) =>
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<STTState>({
      buffer: new Float32Array(0),
      partialText: "",
      sequenceId: 0,
      isProcessing: false,
    })

    const transcriptionQueue = yield* Queue.unbounded<TranscriptionChunk>()

    function concatenateAudio(
      existing: Float32Array,
      newData: Float32Array | Int16Array
    ): Float32Array {
      const result = new Float32Array(existing.length + newData.length)
      result.set(existing)

      if (newData instanceof Int16Array) {
        for (let i = 0; i < newData.length; i++) {
          result[existing.length + i] = newData[i] / 32768.0
        }
      } else {
        result.set(newData, existing.length)
      }

      return result
    }

    function simulateTranscription(audio: Float32Array): string {
      const duration = audio.length / sampleRate
      if (duration < 0.1) return ""

      const wordCount = Math.floor(duration * 2.5)
      const words = [
        "hello", "world", "greetings", "traveler", "welcome",
        "what", "brings", "you", "here", "today",
        "i", "am", "the", "guardian", "of", "this", "place",
        "speak", "your", "purpose", "clearly",
        "the", "path", "ahead", "is", "dangerous",
        "many", "have", "tried", "and", "failed",
        "but", "perhaps", "you", "are", "different",
      ]

      const selected: string[] = []
      for (let i = 0; i < wordCount && i < words.length; i++) {
        selected.push(words[i % words.length])
      }

      return selected.join(" ")
    }

    return {
      transcribeChunk: (chunk: AudioChunk) =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef)
          const newBuffer = concatenateAudio(state.buffer, chunk.data)

          const duration = newBuffer.length / sampleRate
          let text = ""
          let isFinal = false

          if (duration >= 0.5) {
            text = simulateTranscription(newBuffer)
            isFinal = chunk.isFinal || duration >= 2.0

            yield* Ref.set(stateRef, {
              buffer: isFinal ? new Float32Array(0) : newBuffer,
              partialText: text,
              sequenceId: state.sequenceId + 1,
              isProcessing: false,
            })
          } else {
            yield* Ref.set(stateRef, {
              ...state,
              buffer: newBuffer,
            })
          }

          const result: TranscriptionChunk = {
            text,
            confidence: text.length > 0 ? 0.85 + Math.random() * 0.15 : 0,
            timestamp: Date.now(),
            sequenceId: state.sequenceId,
            isFinal,
            startTime: chunk.timestamp,
            endTime: Date.now(),
          }

          yield* Queue.offer(transcriptionQueue, result)

          return result
        }),

      transcribeStream: (chunks: Stream.Stream<AudioChunk>) =>
        Effect.succeed(
          chunks.pipe(
            Stream.map((chunk) => {
              // @ts-ignore - simplified streaming transcription
              const newBuffer = chunk.data instanceof Int16Array
                ? (() => {
                    const result = new Float32Array(chunk.data.length)
                    for (let i = 0; i < chunk.data.length; i++) {
                      result[i] = chunk.data[i] / 32768.0
                    }
                    return result
                  })()
                : chunk.data as Float32Array

              const duration = newBuffer.length / sampleRate
              const text = duration >= 0.1 ? simulateTranscription(newBuffer) : ""

              return {
                text,
                confidence: text.length > 0 ? 0.85 + Math.random() * 0.15 : 0,
                timestamp: Date.now(),
                sequenceId: Date.now(),
                isFinal: chunk.isFinal,
                startTime: chunk.timestamp,
                endTime: Date.now(),
              }
            })
          )
        ) as any,

      getPartialTranscription: () =>
        Ref.get(stateRef).pipe(
          Effect.map((s) => s.partialText)
        ),

      reset: () =>
        Ref.set(stateRef, {
          buffer: new Float32Array(0),
          partialText: "",
          sequenceId: 0,
          isProcessing: false,
        }),
    }
  })

export const STTEngineLive = (model: string, sampleRate: number) =>
  Layer.effect(STTEngine, makeSTTEngine(model, sampleRate))
