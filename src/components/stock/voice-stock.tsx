'use client';

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useIncentiveSession } from '@/components/incentives/session-context';
import { MAX_STOCK_QUERY_LENGTH } from '@/lib/stock/limits';
import type {
  AvailableStockItem,
  CopilotResponse,
  CustomerLookupItem,
  ProformaAssistantResponse,
  ProformaDraft,
  StockAssistantConversationMessage,
  StockAssistantRequestResult,
} from '@/lib/stock/types';

const LOGO = '/WhatsApp Image 2026-08-01 at 1.15.58 PM.jpeg';
const MAX_RECORDING_MS = 45_000;

type VoiceState = 'idle' | 'listening' | 'recording' | 'transcribing';

interface ChatTurn {
  id: string;
  query: string;
  state: 'loading' | 'complete' | 'error';
  response?: CopilotResponse;
  error?: string;
}

interface BrowserSpeechEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface BrowserSpeechErrorEvent {
  error: string;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: BrowserSpeechEvent) => void) | null;
  onerror: ((event: BrowserSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export function VoiceStock() {
  const { actor, logout, request } = useIncentiveSession();
  const [query, setQuery] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [proformaDraft, setProformaDraft] = useState<ProformaDraft | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [transcriptionConfigured, setTranscriptionConfigured] = useState<boolean | null>(null);
  const [transcriptionConfigError, setTranscriptionConfigError] = useState('');
  const [transcriptionModel, setTranscriptionModel] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<number | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let active = true;
    void request<{ configured: boolean; model: string }>('/api/stock/transcribe')
      .then((configuration) => {
        if (!active) return;
        setTranscriptionConfigured(configuration.configured);
        setTranscriptionModel(configuration.model);
        setTranscriptionConfigError('');
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setTranscriptionConfigured(false);
        setTranscriptionConfigError(reason instanceof Error
          ? reason.message
          : 'Could not check the transcription service.');
      });
    return () => { active = false; };
  }, [request]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns, voiceState]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`;
  }, [query]);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    if (recordingTimeoutRef.current !== null) window.clearTimeout(recordingTimeoutRef.current);
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const assistantBusy = turns.some((turn) => turn.state === 'loading');
  const voiceBusy = voiceState !== 'idle';
  const inputBusy = assistantBusy || voiceState === 'transcribing';
  const microphoneDisabled = inputBusy || transcriptionConfigured === null;

  function startNewChat() {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    stopMediaStream();
    setQuery('');
    setTurns([]);
    setProformaDraft(null);
    setVoiceState('idle');
  }

  async function runQuery(value: string) {
    const nextQuery = value.trim();
    if (!nextQuery || assistantBusy) return;
    const history = conversationHistory(turns);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setQuery('');
    setTurns((current) => [...current, { id, query: nextQuery, state: 'loading' }]);

    try {
      const response = await request<CopilotResponse>('/api/stock/assistant', {
        method: 'POST',
        body: JSON.stringify({ query: nextQuery, history, proformaDraft }),
      });
      if (response.kind === 'proforma') setProformaDraft(response.draft);
      setTurns((current) => current.map((turn) => (
        turn.id === id ? { ...turn, state: 'complete', response } : turn
      )));
    } catch (reason) {
      setTurns((current) => current.map((turn) => (
        turn.id === id
          ? {
            ...turn,
            state: 'error',
            error: reason instanceof Error ? reason.message : 'The inventory request failed.',
          }
          : turn
      )));
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runQuery(query);
  }

  async function downloadProforma(draft: ProformaDraft) {
    if (!draft.customer || draft.lines.length === 0) return;
    try {
      const response = await fetch('/api/odoo/proforma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: draft.company.id,
          customerId: draft.customer.id,
          issueDate: draft.issueDate,
          validityDays: draft.validityDays,
          lines: draft.lines.map((line) => ({
            productId: line.id,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(error.error ?? 'Could not generate the PI PDF.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `proforma-${draft.customer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      appendClientError(reason instanceof Error ? reason.message : 'Could not generate the PI PDF.');
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void runQuery(query);
    }
  }

  async function toggleVoice() {
    if (voiceState === 'recording') {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (voiceState === 'listening') {
      recognitionRef.current?.stop();
      return;
    }
    if (voiceState !== 'idle' || assistantBusy) return;

    if (transcriptionConfigured) {
      await startMediaRecording();
      return;
    }
    if (transcriptionConfigError) {
      try {
        const configuration = await request<{ configured: boolean; model: string }>(
          '/api/stock/transcribe',
        );
        setTranscriptionConfigured(configuration.configured);
        setTranscriptionModel(configuration.model);
        setTranscriptionConfigError('');
        if (configuration.configured) {
          await startMediaRecording();
          return;
        }
      } catch (reason) {
        appendClientError(reason instanceof Error
          ? `Could not connect to server transcription: ${reason.message}`
          : 'Could not connect to server transcription.');
        return;
      }
    }
    startBrowserRecognition();
  }

  async function startMediaRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      appendClientError('Audio recording is not supported in this browser. Type the request instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const mimeType = preferredMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        stopMediaStream();
        setVoiceState('idle');
        appendClientError('The browser could not record audio. Please try again.');
      };
      recorder.onstop = () => {
        if (recordingTimeoutRef.current !== null) {
          window.clearTimeout(recordingTimeoutRef.current);
          recordingTimeoutRef.current = null;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stopMediaStream();
        setVoiceState('transcribing');
        void transcribeAndRun(blob);
      };

      recorder.start();
      setVoiceState('recording');
      recordingTimeoutRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, MAX_RECORDING_MS);
    } catch (reason) {
      stopMediaStream();
      setVoiceState('idle');
      appendClientError(reason instanceof DOMException && reason.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow microphone access or type the request.'
        : 'Could not access the microphone.');
    }
  }

  function startBrowserRecognition() {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) {
      appendClientError('Voice transcription is unavailable in this browser. Type the request instead.');
      return;
    }

    const recognition = new Constructor();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        void runQuery(transcript);
      } else {
        appendClientError('No speech was detected. Please try again.');
      }
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') appendClientError(browserSpeechErrorMessage(event.error));
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setVoiceState('idle');
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setVoiceState('listening');
    } catch {
      recognitionRef.current = null;
      appendClientError('Browser speech recognition could not start. Type the request or configure OpenAI transcription.');
    }
  }

  async function transcribeAndRun(blob: Blob) {
    try {
      const form = new FormData();
      form.set('audio', blob, audioFilename(blob.type));
      const data = await request<{ transcript: string }>('/api/stock/transcribe', {
        method: 'POST',
        body: form,
      });
      setVoiceState('idle');
      await runQuery(data.transcript);
    } catch (reason) {
      appendClientError(reason instanceof Error ? reason.message : 'Could not transcribe the recording.');
      setVoiceState('idle');
    }
  }

  function appendClientError(message: string) {
    setTurns((current) => [...current, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      query: 'Voice request',
      state: 'error',
      error: message,
    }]);
  }

  function stopMediaStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#212121] font-sans text-[#ececec]">
      <header className="flex h-14 shrink-0 items-center justify-between bg-[#212121] px-4 md:px-6">
        <Link href="/" aria-label="Portal home" className="flex min-w-0 items-center gap-3 rounded-lg px-1 py-1 transition hover:bg-white/5">
          <span className="flex h-8 w-24 items-center justify-center overflow-hidden rounded-md bg-white px-1.5">
            <Image src={LOGO} alt="Sunlectric" width={90} height={27} className="object-contain" priority />
          </span>
          <span className="truncate text-sm font-semibold">Inventory Copilot</span>
        </Link>
        <div className="flex items-center gap-3 text-xs text-[#b4b4b4]">
          <span className="hidden sm:inline">{actor.name}</span>
          <button type="button" onClick={startNewChat} disabled={assistantBusy || voiceState === 'transcribing'} className="rounded-lg px-3 py-2 font-medium transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">New chat</button>
          <button type="button" onClick={() => void logout()} className="rounded-lg px-3 py-2 font-medium transition hover:bg-white/10 hover:text-white">Sign out</button>
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div aria-live="polite" className="mx-auto w-full max-w-3xl space-y-9 px-4 pb-52 pt-7 md:px-6 md:pt-12">
            {turns.length === 0 && voiceState === 'idle' ? (
              <div className="flex min-h-[48vh] items-center justify-center text-center">
                <h1 className="text-2xl font-semibold tracking-tight text-[#f4f4f4] md:text-3xl">What can I help you find?</h1>
              </div>
            ) : null}

            {turns.map((turn) => <ConversationTurn key={turn.id} turn={turn} onFollowup={runQuery} onDownload={downloadProforma} />)}

            {voiceState === 'recording' || voiceState === 'listening' ? (
              <div className="flex justify-end">
                <div className="flex items-center gap-3 rounded-3xl bg-[#303030] px-4 py-3 text-sm font-medium text-[#ff8b7b]">
                  <span className="flex h-3 items-end gap-0.5" aria-hidden="true">
                    {[7, 12, 9, 14, 8].map((height, index) => (
                      <span key={index} className="w-0.5 animate-pulse rounded-full bg-[#ff6b5a]" style={{ height }} />
                    ))}
                  </span>
                  Listening… tap the microphone to finish
                </div>
              </div>
            ) : null}
            {voiceState === 'transcribing' ? (
              <div className="flex items-center gap-3 text-sm text-[#b4b4b4]">
                <AssistantAvatar />
                <Spinner /> Transcribing your request…
              </div>
            ) : null}
            <div ref={conversationEndRef} />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#212121] via-[#212121] to-transparent px-3 pb-3 pt-14 md:pb-5">
          <div className="pointer-events-auto mx-auto w-full max-w-3xl">
            <form onSubmit={submit} className="rounded-[26px] bg-[#303030] px-3 py-2 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_8px_28px_rgba(0,0,0,0.3)] transition focus-within:shadow-[0_0_0_1px_rgba(255,255,255,0.16),0_8px_30px_rgba(0,0,0,0.35)]">
              <textarea
                ref={textareaRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                maxLength={MAX_STOCK_QUERY_LENGTH}
                rows={1}
                placeholder="Ask about stock, customers, or create a PI"
                aria-label="Ask the ERP copilot"
                className="max-h-48 min-h-7 w-full resize-none overflow-y-auto bg-transparent px-2 pt-2 text-[15px] leading-6 text-[#ececec] outline-none placeholder:text-[#9b9b9b] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              />
              <div className="flex items-center justify-end gap-3 pt-1">
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void toggleVoice()}
                    disabled={microphoneDisabled}
                    aria-label={voiceBusy ? 'Stop listening' : 'Speak inventory request'}
                    className={`flex h-9 w-9 items-center justify-center rounded-full transition disabled:cursor-wait disabled:opacity-40 ${voiceBusy ? 'bg-[#ff6b5a] text-white' : 'text-[#d7d7d7] hover:bg-white/10'}`}
                  >
                    {voiceState === 'transcribing' ? <Spinner /> : voiceBusy ? <StopIcon /> : <MicrophoneIcon />}
                  </button>
                  <button
                    type="submit"
                    disabled={!query.trim() || inputBusy}
                    aria-label="Send inventory request"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#212121] transition hover:bg-[#e7e7e7] disabled:cursor-not-allowed disabled:bg-[#676767] disabled:text-[#303030]"
                  >
                    {assistantBusy ? <Spinner dark /> : <SendIcon />}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

function ConversationTurn({ turn, onFollowup, onDownload }: {
  turn: ChatTurn;
  onFollowup: (query: string) => Promise<void>;
  onDownload: (draft: ProformaDraft) => Promise<void>;
}) {
  return (
    <div className="space-y-7">
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap rounded-3xl bg-[#303030] px-5 py-3 text-[15px] leading-6 text-[#f4f4f4] md:max-w-2xl">
          {turn.query}
        </div>
      </div>

      <div className="flex items-start gap-4">
        <AssistantAvatar />
        {turn.state === 'loading' ? (
          <div className="flex items-center gap-2 py-1.5 text-sm text-[#b4b4b4]">
            <ThinkingDots /> Checking Odoo…
          </div>
        ) : turn.state === 'error' ? (
          <div role="alert" className="min-w-0 flex-1 rounded-2xl bg-[#3a2525] px-4 py-3 text-sm leading-6 text-[#ffb4a9]">
            {turn.error}
          </div>
        ) : turn.response ? (
          <div className="min-w-0 flex-1 space-y-4">
            <div className="py-1 text-[15px] leading-6 text-[#ececec]">
              {turn.response.assistantMessage}
            </div>
            {turn.response.kind === 'stock' && turn.response.warning ? (
              <div role="status" className="rounded-xl bg-[#3b3323] px-3 py-2 text-xs leading-5 text-[#f4cf86]">
                {turn.response.warning}
              </div>
            ) : null}
            {turn.response.kind === 'proforma' ? (
              <ProformaPreview response={turn.response} onFollowup={onFollowup} onDownload={onDownload} />
            ) : turn.response.kind === 'customer' ? (
              <div className="space-y-3">
                {turn.response.customers.map((customer) => (
                  <CustomerCard key={customer.id} customer={customer} />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {turn.response.requests.map((item, index) => (
                  <ResolvedRequest key={`${item.requested}-${index}`} item={item} />
                ))}
              </div>
            )}
            <p className="px-1 text-[10px] text-[#777]">
              {turn.response.kind === 'proforma'
                ? 'Company, customer, products, availability, and GST are verified against Odoo'
                : turn.response.kind === 'customer'
                ? 'Matched against Odoo customers'
                : turn.response.source === 'ai'
                  ? `Interpreted by ${turn.response.model}`
                  : 'Resolved with deterministic matching'} · Live at {formatDateTime(turn.response.fetchedAt)}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProformaPreview({
  response,
  onFollowup,
  onDownload,
}: {
  response: ProformaAssistantResponse;
  onFollowup: (query: string) => Promise<void>;
  onDownload: (draft: ProformaDraft) => Promise<void>;
}) {
  const { draft } = response;
  return (
    <section className="overflow-hidden rounded-2xl bg-[#2b2b2b] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9b9b9b]">Proforma invoice draft</p>
          <p className="mt-1 text-sm font-semibold text-[#f4f4f4]">{draft.company.name}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${response.action === 'finalized' ? 'bg-[#173c31] text-[#79e2b6]' : 'bg-white/[0.07] text-[#bbb]'}`}>
          {response.action === 'finalized' ? 'Ready' : 'Draft'}
        </span>
      </div>

      {draft.pendingCustomerCandidates.length > 0 ? (
        <div className="space-y-2 border-b border-white/[0.06] px-4 py-4 sm:px-5">
          <p className="text-sm text-[#e7e7e7]">I found multiple matching customers. Which one do you want?</p>
          {draft.pendingCustomerCandidates.map((customer, index) => (
            <button key={customer.id} type="button" onClick={() => void onFollowup(`customer ${index + 1}`)} className="w-full rounded-xl bg-white/[0.05] px-3 py-3 text-left transition hover:bg-white/[0.1]">
              <span className="block text-sm font-semibold text-white">Customer {index + 1}: {customer.name}</span>
              <span className="mt-1 block truncate text-xs text-[#aaa]">{customer.address?.replace(/\n/g, ', ') ?? 'Address not available'} {customer.gstNo ? `· GSTIN ${customer.gstNo}` : ''} {customer.phone ? `· ${customer.phone}` : ''}</span>
            </button>
          ))}
        </div>
      ) : null}

      {draft.pendingProductCandidates.length > 0 ? (
        <div className="space-y-2 border-b border-white/[0.06] px-4 py-4 sm:px-5">
          <p className="text-sm text-[#e7e7e7]">I found multiple matching products. Which one do you want?</p>
          {draft.pendingProductCandidates.map((product, index) => (
            <button key={product.id} type="button" onClick={() => void onFollowup(`product ${index + 1}`)} className="w-full rounded-xl bg-white/[0.05] px-3 py-3 text-left transition hover:bg-white/[0.1]">
              <span className="block text-sm font-semibold text-white">Product {index + 1}: {product.name}</span>
              <span className="mt-1 block text-xs text-[#aaa]">{product.sku ?? 'No SKU'} · GST {product.taxRate}% · Available {formatQuantity(product.available)}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 px-4 py-4 text-sm sm:grid-cols-2 sm:px-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#898989]">From</p>
          <p className="mt-1 font-medium text-[#ececec]">{draft.company.name}</p>
          {draft.company.gstNo ? <p className="mt-1 font-mono text-xs text-[#aaa]">GSTIN {draft.company.gstNo}</p> : null}
          {draft.company.address ? <p className="mt-1 whitespace-pre-line text-xs leading-5 text-[#aaa]">{draft.company.address}</p> : null}
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#898989]">Bill to</p>
          {draft.customer ? <>
            <p className="mt-1 font-medium text-[#ececec]">{draft.customer.name}</p>
            {draft.customer.gstNo ? <p className="mt-1 font-mono text-xs text-[#aaa]">GSTIN {draft.customer.gstNo}</p> : null}
            {draft.customer.address ? <p className="mt-1 whitespace-pre-line text-xs leading-5 text-[#aaa]">{draft.customer.address}</p> : null}
          </> : <p className="mt-1 text-xs text-[#e7b468]">Select a customer to continue.</p>}
        </div>
      </div>

      {draft.lines.length > 0 ? (
        <div className="overflow-x-auto border-t border-white/[0.06]">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-white/[0.035] text-[9px] font-bold uppercase tracking-[0.12em] text-[#929292]">
              <tr><th className="px-4 py-2.5">Product</th><th className="px-3 py-2.5">Qty</th><th className="px-3 py-2.5">Price</th><th className="px-3 py-2.5">GST</th><th className="px-4 py-2.5 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {draft.lines.map((line) => (
                <tr key={`${line.id}-${line.unitPrice}`}>
                  <td className="px-4 py-3"><p className="font-medium text-[#e9e9e9]">{line.name}</p><p className="mt-1 font-mono text-[10px] text-[#858585]">{line.sku ?? 'No SKU'}</p></td>
                  <td className="px-3 py-3 text-[#d8d8d8]">{formatQuantity(line.quantity)}</td>
                  <td className="px-3 py-3 text-[#d8d8d8]">{formatCurrency(line.unitPrice)}</td>
                  <td className="px-3 py-3 text-[#d8d8d8]">{line.taxRate}%<span className="block text-[10px] text-[#858585]">{formatCurrency(line.gstAmount)}</span></td>
                  <td className="px-4 py-3 text-right font-semibold text-[#f0f0f0]">{formatCurrency(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 border-t border-white/[0.06] px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <div className="text-[11px] leading-5 text-[#929292]">Issued {formatShortDate(draft.issueDate)} · Valid for {draft.validityDays} days</div>
        <div className="w-full max-w-[220px] space-y-1.5 text-sm">
          <div className="flex justify-between text-[#aaa]"><span>Subtotal</span><span>{formatCurrency(draft.subtotal)}</span></div>
          <div className="flex justify-between text-[#aaa]"><span>GST</span><span>{formatCurrency(draft.gstTotal)}</span></div>
          <div className="flex justify-between border-t border-white/[0.1] pt-2 text-base font-semibold text-white"><span>Grand total</span><span>{formatCurrency(draft.grandTotal)}</span></div>
        </div>
      </div>

      {draft.customer && draft.lines.length > 0 ? (
        <div className="flex justify-end border-t border-white/[0.06] px-4 py-3 sm:px-5">
          {response.action === 'finalized' ? (
            <button type="button" onClick={() => void onDownload(draft)} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-[#212121] transition hover:bg-[#e5e5e5]">Download PI PDF</button>
          ) : (
            <button type="button" onClick={() => void onFollowup('generate PI')} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-[#212121] transition hover:bg-[#e5e5e5]">Generate PI PDF</button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function CustomerCard({ customer }: { customer: CustomerLookupItem }) {
  return (
    <article className="overflow-hidden rounded-2xl bg-[#2b2b2b] px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] sm:px-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#3d3d3d] text-sm font-semibold text-[#f0f0f0]">
          {customerInitials(customer.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-6 text-[#f2f2f2]">{customer.name}</h2>
          <p className="mt-0.5 text-[10px] text-[#777]">Odoo customer #{customer.id}</p>
        </div>
      </div>
      <dl className="mt-4 grid gap-4 border-t border-white/[0.06] pt-4 sm:grid-cols-2">
        <CustomerField label="GSTIN" value={customer.gstNo} mono />
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7f7f7f]">Phone</dt>
          <dd className="mt-1 text-sm text-[#d8d8d8]">
            {customer.phone ? (
              <a className="block hover:text-white" href={`tel:${customer.phone}`}>{customer.phone}</a>
            ) : <span className="text-[#737373]">Not available</span>}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7f7f7f]">Address</dt>
          <dd className="mt-1 whitespace-pre-line text-sm leading-6 text-[#d8d8d8]">
            {customer.address || <span className="text-[#737373]">Not available</span>}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function CustomerField({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7f7f7f]">{label}</dt>
      <dd className={`mt-1 text-sm text-[#d8d8d8] ${mono ? 'font-mono' : ''}`}>
        {value || <span className="font-sans text-[#737373]">Not available</span>}
      </dd>
    </div>
  );
}

function ResolvedRequest({ item }: { item: StockAssistantRequestResult }) {
  const status = statusPresentation(item.status);
  return (
    <article className="overflow-hidden rounded-2xl bg-[#2b2b2b] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
      <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.13em] text-[#8f8f8f]">{item.requested}</p>
          <h2 className="mt-1 text-sm font-semibold text-[#f0f0f0]">{item.interpretation}</h2>
        </div>
        <span className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${status.badge}`}>{status.label}</span>
      </div>
      {item.products.length > 0 ? (
        <div className="divide-y divide-white/[0.06]">
          {item.products.map((product) => <ProductMatch key={product.id} product={product} />)}
        </div>
      ) : (
        <p className="px-4 pb-4 text-xs leading-5 text-[#aaa]">{item.reason}</p>
      )}
      {item.products.length > 0 && item.reason ? (
        <p className="bg-white/[0.025] px-4 py-2 text-[10px] leading-4 text-[#858585]">{item.reason}</p>
      ) : null}
    </article>
  );
}

function ProductMatch({ product }: { product: AvailableStockItem }) {
  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] font-bold text-[#969696]">{product.sku ?? 'No SKU'}</span>
          <span className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-medium text-[#aaa]">{product.uom}</span>
        </div>
        <p className="mt-1 text-sm font-medium leading-5 text-[#ededed]">{product.name}</p>
        <p className="mt-1 text-[10px] text-[#898989]">On hand {formatQuantity(product.onHand)} · Forecast {formatQuantity(product.forecast)}</p>
      </div>
      <div className="flex items-baseline gap-1 rounded-xl bg-[#173c31] px-3 py-2 text-[#79e2b6]">
        <span className="font-mono text-lg font-bold">{formatQuantity(product.available)}</span>
        <span className="text-[9px] font-bold uppercase tracking-wide">available</span>
      </div>
    </div>
  );
}

function conversationHistory(turns: ChatTurn[]): StockAssistantConversationMessage[] {
  return turns
    .filter((turn): turn is ChatTurn & { response: CopilotResponse } => (
      turn.state === 'complete' && Boolean(turn.response)
    ))
    .flatMap((turn) => [
      { role: 'user' as const, content: turn.query },
      {
        role: 'assistant' as const,
        content: assistantHistoryContent(turn.response),
      },
    ])
    .slice(-8);
}

function assistantHistoryContent(response: CopilotResponse): string {
  if (response.kind === 'proforma') {
    return [
      response.assistantMessage,
      response.draft.customer ? `PI customer: ${response.draft.customer.name}` : 'PI customer awaiting selection',
      ...response.draft.lines.map((line) => `PI line: ${line.name}, ${line.quantity} at ${line.unitPrice}`),
    ].join('\n');
  }
  if (response.kind === 'customer') {
    return [
      response.assistantMessage,
      ...response.customers.map((customer) => `Customer: ${customer.name}`),
    ].join('\n');
  }
  return [
    response.assistantMessage,
    ...response.requests.map((item) => (
      `${item.interpretation}: ${item.status}; ${item.products.map((product) => product.name).join(', ') || 'no catalog match'}`
    )),
  ].join('\n');
}

function customerInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'CU';
}

function statusPresentation(status: StockAssistantRequestResult['status']) {
  if (status === 'matched') {
    return { label: 'Matched', badge: 'bg-[#173c31] text-[#79e2b6]' };
  }
  if (status === 'possible_match') {
    return { label: 'Possible match', badge: 'bg-[#44391f] text-[#f4cf86]' };
  }
  return { label: 'Not found', badge: 'bg-[#482929] text-[#ffaaa0]' };
}

function preferredMimeType(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function audioFilename(type: string): string {
  if (type.includes('mp4')) return 'speech.mp4';
  if (type.includes('ogg')) return 'speech.ogg';
  return 'speech.webm';
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function browserSpeechErrorMessage(error: string): string {
  if (error === 'network') {
    return 'Browser speech recognition could not reach its network service. Retry, or use OpenAI transcription.';
  }
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return 'Microphone or speech-service permission was denied. Allow access and try again.';
  }
  if (error === 'no-speech') return 'No speech was detected. Please speak again.';
  if (error === 'audio-capture') return 'No working microphone was detected.';
  return `Browser speech recognition failed (${error}). Type the request or try again.`;
}

function AssistantAvatar() {
  return <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f4f4f4] text-[#212121]"><SparklesIcon /></div>;
}

function SparklesIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><path d="M12 3l1.25 3.75L17 8l-3.75 1.25L12 13l-1.25-3.75L7 8l3.75-1.25L12 3zM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2zM5.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" /></svg>;
}

function MicrophoneIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8"><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg>;
}

function StopIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-current"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
}

function SendIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2"><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" /></svg>;
}

function Spinner({ dark = false }: { dark?: boolean }) {
  return <span aria-hidden="true" className={`h-4 w-4 animate-spin rounded-full border-2 ${dark ? 'border-black/20 border-t-black/70' : 'border-white/40 border-t-white'}`} />;
}

function ThinkingDots() {
  return (
    <span aria-hidden="true" className="flex items-center gap-1">
      {[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#a0a0a0]" style={{ animationDelay: `${dot * 140}ms` }} />)}
    </span>
  );
}
