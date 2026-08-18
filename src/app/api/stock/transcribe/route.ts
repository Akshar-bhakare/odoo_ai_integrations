import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  apiErrorResponse,
  legacyOdooRouteGuard,
  requireAuthenticatedActor,
} from '@/lib/auth/api-auth';

export const runtime = 'nodejs';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const DEFAULT_MODEL = 'gpt-transcribe';

export async function GET(request: NextRequest) {
  const authError = await legacyOdooRouteGuard(request);
  if (authError) return authError;
  return NextResponse.json({
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_MODEL,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  try {
    await requireAuthenticatedActor(request, { write: true });
  } catch (error) {
    return apiErrorResponse(error);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OpenAI transcription is not configured.' },
      { status: 503 },
    );
  }

  try {
    const incoming = await request.formData();
    const audio = incoming.get('audio');
    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json({ error: 'An audio recording is required.' }, { status: 400 });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json({ error: 'The recording must be smaller than 10 MB.' }, { status: 413 });
    }
    if (!isSupportedAudio(audio)) {
      return NextResponse.json({ error: 'Unsupported audio format.' }, { status: 415 });
    }

    const form = new FormData();
    form.set('file', audio, safeAudioFilename(audio));
    form.set('model', process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || DEFAULT_MODEL);
    form.set('response_format', 'json');
    form.set(
      'prompt',
      'Transcribe the complete Sunlectric solar inventory request verbatim, including every list item, number, model suffix, unit, and color. Vocabulary includes Waaree, Polycab, Growatt, Renew, DCR, NDCR, TopCon, PERC, Wp, kW, mm squared, MPPT, ACDB, and DCDB.',
    );

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.json().catch(() => ({})) as {
      text?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      console.error('OpenAI transcription failed:', response.status, body.error?.message);
      return NextResponse.json(
        { error: transcriptionErrorMessage(response.status) },
        { status: response.status === 429 ? 429 : response.status >= 500 ? 502 : 400 },
      );
    }

    const transcript = body.text?.trim();
    if (!transcript) {
      return NextResponse.json(
        { error: 'No speech was detected in the recording.' },
        { status: 422 },
      );
    }
    return NextResponse.json({ transcript });
  } catch (error) {
    console.error('Audio transcription failed:', error);
    const timedOut = error instanceof Error
      && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return NextResponse.json(
      {
        error: timedOut
          ? 'Transcription timed out. Please try again or type the request.'
          : 'Could not connect to the transcription service. Please retry or type the request.',
      },
      { status: timedOut ? 504 : 502 },
    );
  }
}

function transcriptionErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'OpenAI transcription authentication failed. Check the server API key.';
  }
  if (status === 429) {
    return 'OpenAI transcription is temporarily unavailable because of billing or rate limits.';
  }
  if (status >= 500) {
    return 'OpenAI transcription is temporarily unavailable. Please retry or type the request.';
  }
  return 'The recording format or audio could not be transcribed. Please record again.';
}

function isSupportedAudio(file: File): boolean {
  const type = file.type.toLowerCase();
  return type.startsWith('audio/') || type.startsWith('video/webm');
}

function safeAudioFilename(file: File): string {
  if (/\.(webm|wav|mp3|mp4|m4a|ogg)$/i.test(file.name)) return file.name;
  const type = file.type.toLowerCase();
  if (type.includes('mp4')) return 'speech.mp4';
  if (type.includes('ogg')) return 'speech.ogg';
  if (type.includes('wav')) return 'speech.wav';
  return 'speech.webm';
}
