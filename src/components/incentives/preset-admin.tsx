"use client";

import { useCallback, useEffect, useState } from "react";
import { useIncentiveSession } from "./session-context";
import {
  Badge,
  buttonClass,
  Card,
  EmptyState,
  ErrorBanner,
  inputClass,
  LoadingState,
  secondaryButtonClass,
} from "./ui";
import { PresetForm } from "./preset-form";
import type {
  PresetRecord,
  PresetVersionDetail,
} from "@/lib/incentives/ui/types";
import { canAdminister } from "@/lib/incentives/ui/permissions";
import { date, relationId } from "@/lib/incentives/ui/format";
import {
  defaultPreset,
  presetFormErrors,
} from "@/lib/incentives/ui/preset-defaults";
import type { IncentivePresetV1 } from "@/lib/incentives/types";

export function PresetAdmin() {
  const { actor, request } = useIncentiveSession();
  const [presets, setPresets] = useState<PresetRecord[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [versions, setVersions] = useState<PresetVersionDetail[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [detail, setDetail] = useState<PresetVersionDetail | null>(null);
  const [draft, setDraft] = useState<IncentivePresetV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [validation, setValidation] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");

  const loadWorkspace = useCallback(
    async (preferredPreset?: number, preferredVersion?: number) => {
      const data = await request<{
        presets: PresetRecord[];
        versions: PresetVersionDetail[];
      }>("/api/incentives/presets/workspace");
      setPresets(data.presets);
      setVersions(data.versions);
      const presetId = preferredPreset ?? data.presets[0]?.id ?? null;
      setSelectedPreset(presetId);
      const preset = data.presets.find((item) => item.id === presetId);
      const matchingVersions = data.versions.filter(
        (version) => relationId(version.x_preset_id) === presetId,
      );
      const versionId =
        preferredVersion ??
        relationId(preset?.x_current_version_id) ??
        matchingVersions[0]?.id ??
        null;
      setSelectedVersion(versionId);
      const selected =
        data.versions.find((version) => version.id === versionId) ?? null;
      setDetail(selected);
      setDraft(selected ? structuredClone(selected.rules) : null);
      setValidation([]);
    },
    [request],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      loadWorkspace()
        .catch((reason: unknown) =>
          setError(
            reason instanceof Error ? reason.message : "Could not load presets",
          ),
        )
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selectedVersion) {
        setDetail(null);
        setDraft(null);
        return;
      }
      const selected =
        versions.find((version) => version.id === selectedVersion) ?? null;
      setDetail(selected);
      setDraft(selected ? structuredClone(selected.rules) : null);
      setValidation([]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedVersion, versions]);

  const visibleVersions = versions.filter(
    (version) => relationId(version.x_preset_id) === selectedPreset,
  );

  function choosePreset(presetId: number) {
    setSelectedPreset(presetId);
    const preset = presets.find((item) => item.id === presetId);
    const matchingVersions = versions.filter(
      (version) => relationId(version.x_preset_id) === presetId,
    );
    const versionId =
      relationId(preset?.x_current_version_id) ??
      matchingVersions[0]?.id ??
      null;
    if (versionId) chooseVersion(versionId);
  }

  function chooseVersion(versionId: number) {
    setSelectedVersion(versionId);
    const selected =
      versions.find((version) => version.id === versionId) ?? null;
    setDetail(selected);
    setDraft(selected ? structuredClone(selected.rules) : null);
    setValidation([]);
    setEditorOpen(true);
  }

  if (!canAdminister(actor))
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <ErrorBanner message="Administrator role is required to manage presets." />
      </main>
    );

  async function run(name: string, task: () => Promise<void>) {
    setPending(name);
    setError("");
    try {
      await task();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${name} failed`);
    } finally {
      setPending("");
    }
  }

  async function createPreset() {
    const code = newCode.trim().toUpperCase();
    const name = newName.trim();
    const rules = defaultPreset(code, name);
    await run("Create preset", async () => {
      const created = await request<{ presetId: number; versionId: number }>(
        "/api/incentives/presets",
        { method: "POST", body: JSON.stringify({ code, name, rules }) },
      );
      setCreating(false);
      setNewName("");
      setNewCode("");
      await loadWorkspace(created.presetId, created.versionId);
      setEditorOpen(true);
    });
  }

  async function createVersion() {
    if (!selectedPreset || !draft) return;
    const nextNumber =
      Math.max(
        0,
        ...visibleVersions.map((version) => version.x_version_number),
      ) + 1;
    await run("Create version", async () => {
      const created = await request<{ versionId: number }>(
        `/api/incentives/presets/${selectedPreset}/versions`,
        {
          method: "POST",
          body: JSON.stringify({ versionNumber: nextNumber, rules: draft }),
        },
      );
      await loadWorkspace(selectedPreset, created.versionId);
    });
  }

  async function save() {
    if (!detail || !draft) return;
    const errors = presetFormErrors(draft);
    setValidation(errors);
    if (errors.length) return;
    await run("Save", async () => {
      await request(`/api/incentives/preset-versions/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ rules: draft }),
      });
      await loadWorkspace(selectedPreset ?? undefined, detail.id);
    });
  }

  async function activate() {
    if (!detail || !draft) return;
    const errors = presetFormErrors(draft);
    setValidation(errors);
    if (errors.length) return;
    await run("Activate", async () => {
      await request(`/api/incentives/preset-versions/${detail.id}/activate`, {
        method: "POST",
      });
      await loadWorkspace(selectedPreset ?? undefined, detail.id);
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5 md:px-7">
      <div className="flex justify-end">
        <button onClick={() => setCreating(true)} className={buttonClass}>
          Create preset
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <LoadingState />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Card title="Presets">
            <div className="divide-y divide-border-custom">
              {presets.length === 0 ? (
                <EmptyState
                  title="No presets"
                  detail="Create the first configurable incentive preset."
                />
              ) : (
                presets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => choosePreset(preset.id)}
                    className={`w-full px-4 py-4 text-left ${selectedPreset === preset.id ? "bg-foreground text-background" : "hover:bg-background"}`}
                  >
                    <div className="text-sm font-black">{preset.x_name}</div>
                    <div
                      className={`mt-1 font-mono text-[9px] ${selectedPreset === preset.id ? "text-background/60" : "text-muted-custom"}`}
                    >
                      {preset.x_code}
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>

          <Card
            title="Version history"
            action={
              draft && (
                <button
                  disabled={!!pending}
                  onClick={createVersion}
                  className={secondaryButtonClass}
                >
                  Duplicate
                </button>
              )
            }
          >
            <div className="divide-y divide-border-custom">
              {visibleVersions.length === 0 ? (
                <EmptyState
                  title="No versions"
                  detail="Select a preset to see its version history."
                />
              ) : (
                visibleVersions.map((version) => (
                  <button
                    key={version.id}
                    onClick={() => chooseVersion(version.id)}
                    className="w-full px-4 py-4 text-left hover:bg-background/60"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-black">
                        {version.x_name ||
                          `Version ${version.x_version_number}`}
                      </span>
                      <Badge value={version.x_status} />
                    </div>
                    <div className="mt-2 text-[9px] text-muted-custom">
                      Version {version.x_version_number} ·{" "}
                      {version.x_locked ? "Locked" : "Editable"} ·{" "}
                      {date(version.x_activated_at || version.create_date)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>
        </div>
      )}

      {editorOpen && detail && draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="preset-editor-title"
        >
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border-custom bg-card-bg shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-custom p-4">
              <div>
                <h2 id="preset-editor-title" className="text-lg font-black">
                  {detail.x_name}
                </h2>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-custom">
                  <Badge value={detail.x_status} />
                  <span>{detail.x_locked ? "Read only" : "Draft editor"}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setValidation(presetFormErrors(draft))}
                  className={secondaryButtonClass}
                >
                  Validate
                </button>
                {!detail.x_locked && (
                  <button
                    disabled={!!pending}
                    onClick={save}
                    className={secondaryButtonClass}
                  >
                    Save
                  </button>
                )}
                {detail.x_status === "draft" && !detail.x_locked && (
                  <button
                    disabled={!!pending}
                    onClick={activate}
                    className={buttonClass}
                  >
                    Activate
                  </button>
                )}
                <button
                  onClick={() => setEditorOpen(false)}
                  className={secondaryButtonClass}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto">
              {validation.length > 0 && (
                <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                  <strong>Validation failed</strong>
                  <ul className="mt-2 list-disc pl-5">
                    {validation.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              <PresetForm
                value={draft}
                onChange={setDraft}
                disabled={detail.x_locked}
              />
            </div>
          </div>
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-md rounded-xl border border-border-custom bg-card-bg p-5 shadow-2xl">
            <h2 className="text-lg font-black">Create preset and draft v1</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-[9px] font-bold uppercase tracking-wider text-muted-custom">
                Name
                <input
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="block text-[9px] font-bold uppercase tracking-wider text-muted-custom">
                Code
                <input
                  value={newCode}
                  onChange={(event) =>
                    setNewCode(
                      event.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9_]/g, "_"),
                    )
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setCreating(false)}
                  className={secondaryButtonClass}
                >
                  Cancel
                </button>
                <button
                  disabled={
                    !newName.trim() ||
                    !/^[A-Z][A-Z0-9_]*$/.test(newCode) ||
                    !!pending
                  }
                  onClick={createPreset}
                  className={buttonClass}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
