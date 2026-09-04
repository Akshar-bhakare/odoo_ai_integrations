"use client";

import Link from "next/link";
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
  Metric,
  secondaryButtonClass,
} from "./ui";
import type { CalculationDetailRecord } from "@/lib/incentives/ui/types";
import type { NormalizedCustomerEvent } from "@/lib/incentives/types";
import {
  date,
  money,
  monthLabel,
  percent,
  relationName,
} from "@/lib/incentives/ui/format";
import {
  canApprove,
  canRecordPayment,
  canReview,
} from "@/lib/incentives/ui/permissions";
import { employeeCustomerEventsForMonth } from "@/lib/incentives/ui/view-model";

interface SourceRecord {
  id: number;
  x_source_model: string;
  x_source_record_id: number;
  x_source_key: string;
  x_source_category: string;
  x_signed_amount: number;
  x_source_snapshot_json: string;
}

interface SourceSnapshot {
  employeeId?: number;
  month?: string;
  moveDate?: string;
  moveName?: string;
  partnerName?: string;
  customerId?: number;
  eventDate?: string;
  ownership?: { status?: string; employeeId?: number | null };
  salesOrderNames?: string[];
}

function parseSourceSnapshot(value: string): SourceSnapshot | null {
  try {
    return JSON.parse(value) as SourceSnapshot;
  } catch {
    return null;
  }
}

export function CalculationDetail({
  calculationId,
}: {
  calculationId: number;
}) {
  const { actor, request } = useIncentiveSession();
  const [detail, setDetail] = useState<CalculationDetailRecord | null>(null);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [adjustment, setAdjustment] = useState({
    operation: "add",
    amount: "",
    reason: "",
    notes: "",
  });
  const [payment, setPayment] = useState({
    amount: "",
    paymentDate: new Date().toISOString().slice(0, 10),
    mode: "Bank Transfer",
    reference: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request<{
        calculation: CalculationDetailRecord;
        sources: SourceRecord[];
      }>(`/api/incentives/calculations/${calculationId}/workbench`);
      if (!data.calculation?.result?.mainIncentive || !data.calculation.rules) {
        throw new Error(
          "Calculation details are incomplete. Refresh the page to load the latest snapshot.",
        );
      }
      setDetail(data.calculation);
      setSources(data.sources);
      setPayment((value) => ({
        ...value,
        amount: String(
          Math.max(
            0,
            data.calculation.x_final_incentive - data.calculation.x_paid_amount,
          ),
        ),
      }));
    } catch (reason) {
      setDetail(null);
      setError(
        reason instanceof Error ? reason.message : "Could not load calculation",
      );
    } finally {
      setLoading(false);
    }
  }, [calculationId, request]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function action(
    name: string,
    task: () => Promise<CalculationDetailRecord | void>,
  ) {
    setPending(name);
    setError("");
    try {
      const updated = await task();
      if (updated) setDetail(updated);
      else await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${name} failed`);
    } finally {
      setPending("");
    }
  }

  if (loading)
    return (
      <main className="mx-auto w-full max-w-[1500px] px-4 py-5 md:px-7">
        <LoadingState label="Loading authoritative calculation snapshot…" />
      </main>
    );
  if (!detail)
    return (
      <main className="mx-auto w-full max-w-[1500px] px-4 py-5 md:px-7">
        {error ? (
          <ErrorBanner message={error} />
        ) : (
          <EmptyState
            title="Calculation unavailable"
            detail="The record could not be loaded."
          />
        )}
      </main>
    );
  if (!detail.result?.mainIncentive || !detail.rules)
    return (
      <main className="mx-auto w-full max-w-[1500px] px-4 py-5 md:px-7">
        <ErrorBanner message="Calculation details are incomplete. Refresh the page to load the latest snapshot." />
      </main>
    );

  const { result, rules } = detail;
  const main = result.mainIncentive;
  const customerNames = new Map(
    detail.customers.map((customer) => [customer.id, customer.name]),
  );
  const invoiceNameByMoveId = new Map<number, string>();
  for (const source of sources) {
    const snapshot = parseSourceSnapshot(source.x_source_snapshot_json);
    if (snapshot?.moveName) {
      invoiceNameByMoveId.set(source.x_source_record_id, snapshot.moveName);
    }
  }
  const paidNew = new Set(result.customerIncentive.paidNewCustomerEventIds);
  const paidRepeat = new Set(
    result.customerIncentive.paidRepeatCustomerEventIds,
  );
  const qualifiedNew = new Set(
    result.customerIncentive.qualifiedNewCustomerEventIds,
  );
  const qualifiedRepeat = new Set(
    result.customerIncentive.qualifiedRepeatCustomerEventIds,
  );
  const visibleCustomerEvents = employeeCustomerEventsForMonth(
    detail.input.customerEvents,
    detail.input.employeeId,
    result.month,
  );
  const visibleSources = sources
    .flatMap((source) => {
      const snapshot = parseSourceSnapshot(source.x_source_snapshot_json);
      if (!snapshot) return [];
      const accountingMatch =
        snapshot.employeeId === detail.input.employeeId &&
        snapshot.month === result.month;
      const customerMatch =
        snapshot.eventDate?.slice(0, 7) === result.month &&
        snapshot.ownership?.status === "resolved" &&
        snapshot.ownership.employeeId === detail.input.employeeId;
      if (!accountingMatch && !customerMatch) return [];
      return [
        {
          source,
          snapshot,
          sourceDate: snapshot.moveDate ?? snapshot.eventDate ?? "",
          document:
            snapshot.moveName ??
            (source.x_source_model === "res.partner"
              ? source.x_source_key
              : `#${source.x_source_record_id}`),
          customer:
            snapshot.partnerName ??
            (snapshot.customerId === undefined
              ? "—"
              : (customerNames.get(snapshot.customerId) ??
                `Customer ${snapshot.customerId}`)),
        },
      ];
    })
    .sort(
      (left, right) =>
        right.sourceDate.localeCompare(left.sourceDate) ||
        right.source.x_source_record_id - left.source.x_source_record_id ||
        right.source.id - left.source.id,
    );
  const invoiceActualsByMove = new Map<
    number,
    {
      moveId: number;
      type: string;
      date: string;
      invoice: string;
      salesOrders: string[];
      customer: string;
      sales: number;
      cogs: number;
      transport: number;
      loading: number;
    }
  >();
  for (const item of visibleSources) {
    const category = item.source.x_source_category;
    if (
      item.source.x_source_model !== "account.move" ||
      ![
        "sales",
        "invoice_sales",
        "credit_note_sales",
        "cogs",
        "transport",
        "loading",
      ].includes(category)
    ) {
      continue;
    }
    const moveId = item.source.x_source_record_id;
    const row = invoiceActualsByMove.get(moveId) ?? {
      moveId,
      type: category === "credit_note_sales" ? "Credit Note" : "Invoice",
      date: item.sourceDate,
      invoice: item.document,
      salesOrders: item.snapshot.salesOrderNames ?? [],
      customer: item.customer,
      sales: 0,
      cogs: 0,
      transport: 0,
      loading: 0,
    };
    if (["sales", "invoice_sales", "credit_note_sales"].includes(category)) {
      row.sales = item.source.x_signed_amount;
      if (category === "credit_note_sales") row.type = "Credit Note";
    } else if (category === "cogs") row.cogs = item.source.x_signed_amount;
    else if (category === "transport")
      row.transport = item.source.x_signed_amount;
    else if (category === "loading") row.loading = item.source.x_signed_amount;
    invoiceActualsByMove.set(moveId, row);
  }
  const invoiceActuals = [...invoiceActualsByMove.values()]
    .map((row) => {
      const grossMargin = row.sales - row.cogs;
      const adjustedGrossMargin = grossMargin - row.transport - row.loading;
      return {
        ...row,
        grossMargin,
        adjustedGrossMargin,
        marginPercent: row.sales === 0 ? 0 : adjustedGrossMargin / row.sales,
      };
    })
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) || right.moveId - left.moveId,
    );
  const unresolved = result.resolutionIssues;
  const canEdit =
    canReview(actor) && ["draft", "review"].includes(detail.x_state);
  const achievedSlab =
    main.structure === "slab" && rules.mainIncentive.slab
      ? [...rules.mainIncentive.slab.slabs].reverse().find((slab) => {
          const threshold =
            rules.mainIncentive.slab!.thresholdType === "fixed_amount"
              ? "minimumBase" in slab
                ? slab.minimumBase
                : 0
              : "minimumMultiplier" in slab
                ? slab.minimumMultiplier * main.salaryUsed
                : 0;
          return threshold <= (main.slabSelectionBase ?? 0);
        })
      : undefined;
  const newCustomerEvents = visibleCustomerEvents.filter(
    (event) => event.kind === "new_customer",
  );
  const eligibleRepeatEvents = visibleCustomerEvents.filter(
    (event) => event.kind === "repeat_customer" && paidRepeat.has(event.id),
  );
  const ineligibleRepeatEvents = visibleCustomerEvents.filter(
    (event) => event.kind === "repeat_customer" && !paidRepeat.has(event.id),
  );
  const totalBonuses =
    result.customerIncentive.newCustomerBonus +
    result.customerIncentive.repeatCustomerBonus;

  const adjustmentsContent = (
    <>
      <div className="divide-y divide-border-custom/70">
        {detail.adjustments.length === 0 ? (
          <EmptyState
            title="No adjustments"
            detail="The calculated incentive has not been manually adjusted."
          />
        ) : (
          detail.adjustments.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-4 px-4 py-3 text-xs"
            >
              <div>
                <div className="font-bold">{item.x_reason}</div>
                <div className="mt-1 text-[10px] text-muted-custom">
                  {relationName(item.create_uid)} · {date(item.create_date)}
                  {item.x_notes ? ` · ${item.x_notes}` : ""}
                </div>
              </div>
              <div
                className={`font-mono font-black ${item.x_operation === "add" ? "text-green-700" : "text-red-700"}`}
              >
                {item.x_operation === "add" ? "+" : "−"}
                {money(item.x_amount)}
              </div>
            </div>
          ))
        )}
      </div>
      {canEdit && (
        <form
          className="grid gap-2 border-t border-border-custom bg-background/50 p-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void action("Adjustment", async () => {
              await request(
                `/api/incentives/calculations/${calculationId}/adjustments`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    ...adjustment,
                    amount: Number(adjustment.amount),
                  }),
                },
              );
              await request(
                `/api/incentives/calculations/${calculationId}/recalculate`,
                { method: "POST" },
              );
              setAdjustment({
                operation: "add",
                amount: "",
                reason: "",
                notes: "",
              });
            });
          }}
        >
          <select
            value={adjustment.operation}
            onChange={(event) =>
              setAdjustment({ ...adjustment, operation: event.target.value })
            }
            className={inputClass}
          >
            <option value="add">Addition</option>
            <option value="deduct">Deduction</option>
          </select>
          <input
            type="number"
            min="0.01"
            step="0.01"
            required
            placeholder="Amount"
            value={adjustment.amount}
            onChange={(event) =>
              setAdjustment({ ...adjustment, amount: event.target.value })
            }
            className={inputClass}
          />
          <input
            required
            placeholder="Reason"
            value={adjustment.reason}
            onChange={(event) =>
              setAdjustment({ ...adjustment, reason: event.target.value })
            }
            className={inputClass}
          />
          <input
            placeholder="Notes (optional)"
            value={adjustment.notes}
            onChange={(event) =>
              setAdjustment({ ...adjustment, notes: event.target.value })
            }
            className={inputClass}
          />
          <button
            disabled={!!pending}
            className={`${buttonClass} sm:col-span-2`}
          >
            Save and recalculate
          </button>
        </form>
      )}
    </>
  );

  return (
    <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 md:px-7">
      <div className="flex flex-col justify-between gap-4 border-b border-border-custom pb-4 md:flex-row md:items-end">
        <div>
          <Link
            href="/incentives"
            className="text-[10px] font-black uppercase tracking-wider text-muted-custom hover:text-foreground"
          >
            ← Incentives
          </Link>
          <h1 className="mt-2 text-2xl font-black tracking-tight">
            {relationName(detail.x_employee_id)} · {monthLabel(detail.x_month)}
          </h1>
          <p className="mt-1 text-xs text-muted-custom">
            {relationName(detail.x_preset_version_id)} · Revision{" "}
            {detail.x_revision} · Engine {detail.x_engine_version}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={detail.x_state} />
          {detail.x_payment_state && <Badge value={detail.x_payment_state} />}
          {canEdit && (
            <button
              disabled={!!pending}
              onClick={() =>
                action("Recalculate", () =>
                  request(
                    `/api/incentives/calculations/${calculationId}/recalculate`,
                    { method: "POST" },
                  ),
                )
              }
              className={secondaryButtonClass}
            >
              Recalculate
            </button>
          )}
          {canReview(actor) && detail.x_state === "draft" && (
            <button
              disabled={!!pending}
              onClick={() =>
                action("Submit", () =>
                  request(
                    `/api/incentives/calculations/${calculationId}/submit`,
                    { method: "POST" },
                  ),
                )
              }
              className={buttonClass}
            >
              Submit for review
            </button>
          )}
          {canApprove(actor) && detail.x_state === "review" && (
            <button
              disabled={!!pending || unresolved.length > 0}
              onClick={() =>
                action("Approve", () =>
                  request<CalculationDetailRecord>(
                    `/api/incentives/calculations/${calculationId}/approve`,
                    { method: "POST" },
                  ),
                )
              }
              className={buttonClass}
            >
              Approve authoritative result
            </button>
          )}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {unresolved.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          <div className="font-black uppercase tracking-wider">
            Approval blocked · {unresolved.length} unresolved owner issue
            {unresolved.length === 1 ? "" : "s"}
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {unresolved.map((issue) => (
              <li key={issue.eventId}>{issue.message}</li>
            ))}
          </ul>
          <Link
            href={`/incentives/unresolved?month=${result.month}`}
            className="mt-3 inline-block font-black underline"
          >
            Resolve data
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Salary" value={money(main.salaryUsed)} />
        <Metric
          label="Actual Base"
          value={money(result.accounting.actualBase)}
        />
        <Metric
          label="Calculated Incentive"
          value={money(result.calculatedIncentive)}
        />
        <Metric label="Adjustments" value={money(result.adjustmentTotal)} />
        <Metric
          label="Final Incentive"
          value={money(result.finalIncentive)}
          accent
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Employee">
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 p-4 text-xs">
            <KV label="Employee" value={relationName(detail.x_employee_id)} />
            <KV label="Month" value={monthLabel(detail.x_month)} />
            <KV label="Preset" value={rules.name} />
            <KV
              label="Preset version"
              value={relationName(detail.x_preset_version_id)}
            />
            <KV
              label="Salary source"
              value={String(
                detail.x_salary_used
                  ? detail.result.mainIncentive.salaryVersionId
                  : "—",
              )}
            />
            <KV label="Salary" value={money(main.salaryUsed)} />
          </div>
        </Card>
        <Card title="Review and approval">
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 p-4 text-xs">
            <KV label="State" value={<Badge value={detail.x_state} />} />
            <KV
              label="Reviewer"
              value={relationName(detail.x_reviewed_by_id)}
            />
            <KV label="Reviewed at" value={date(detail.x_reviewed_at)} />
            <KV
              label="Approver"
              value={relationName(detail.x_approved_by_id)}
            />
            <KV label="Approved at" value={date(detail.x_approved_at)} />
            <KV
              label="Input checksum"
              value={
                <span
                  className="font-mono text-[9px]"
                  title={detail.x_input_checksum}
                >
                  {detail.x_input_checksum?.slice(0, 16)}…
                </span>
              }
            />
          </div>
        </Card>
      </div>

      <Card title="Accounting">
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4 lg:grid-cols-7">
          <Metric
            label="Gross Margin"
            value={money(result.accounting.grossMargin)}
          />
          <Metric
            label="Transport"
            value={money(result.accounting.transport)}
          />
          <Metric label="Loading" value={money(result.accounting.loading)} />
          <Metric
            label="Adjusted GM"
            value={money(result.accounting.adjustedGrossMargin)}
          />
          <Metric
            label="Employee Expenses"
            value={money(result.accounting.employeeExpenses)}
          />
          <Metric
            label="Commission"
            value={money(result.accounting.commission)}
          />
          <Metric
            label="Actual Base"
            value={money(result.accounting.actualBase)}
            accent
          />
        </div>
      </Card>

      {main.structure === "flat" && rules.mainIncentive.flat ? (
        <Card title="Flat threshold explanation">
          <div className="grid gap-5 p-4 lg:grid-cols-[1fr_1fr]">
            <div className="overflow-hidden rounded-lg border border-border-custom bg-card-bg">
              <div className="border-b border-border-custom px-4 py-3 text-[10px] font-black uppercase tracking-widest text-muted-custom">
                Adjustments
              </div>
              {adjustmentsContent}
            </div>
            <Explanation
              lines={[
                ["Salary", money(main.salaryUsed)],
                [
                  `Multiplier`,
                  `${rules.mainIncentive.flat.threshold.salaryMultiplier}×`,
                ],
                ["Threshold", money(main.flatThreshold)],
                ["Carry in", money(main.carryIn)],
                ["Required", money(main.requiredThreshold)],
                ["Actual base", money(result.accounting.actualBase)],
                ["Eligible base", money(main.eligibleIncentiveBase)],
                ["Rate", percent(main.achievedRate)],
                ["Main incentive", money(main.incentive)],
              ]}
            />
          </div>
        </Card>
      ) : rules.mainIncentive.slab ? (
        <Card title="Slab explanation">
          <div className="grid gap-5 p-4 lg:grid-cols-[1fr_1fr]">
            <div className="grid grid-cols-2 gap-x-5 gap-y-3 text-xs">
              <KV
                label="Threshold type"
                value={
                  rules.mainIncentive.slab.thresholdType === "fixed_amount"
                    ? "Fixed amount"
                    : "Salary multiple"
                }
              />
              <KV label="First slab" value={money(main.firstSlabThreshold)} />
              <KV label="Carry in" value={money(main.carryIn)} />
              <KV label="Carry consumed" value={money(main.carryConsumed)} />
              <KV
                label="Current recognized base"
                value={money(main.currentRecognizedBase)}
              />
              <KV
                label="Achieved slab"
                value={
                  achievedSlab
                    ? money(
                        main.firstSlabThreshold === null
                          ? 0
                          : rules.mainIncentive.slab.thresholdType ===
                                "fixed_amount" && "minimumBase" in achievedSlab
                            ? achievedSlab.minimumBase
                            : "minimumMultiplier" in achievedSlab
                              ? achievedSlab.minimumMultiplier * main.salaryUsed
                              : 0,
                      )
                    : "No slab"
                }
              />
              <KV label="Achieved rate" value={percent(main.achievedRate)} />
              <KV label="Main incentive" value={money(main.incentive)} />
            </div>
            <div className="rounded-lg border border-border-custom bg-background/60 p-4">
              <div className="mb-3 text-[9px] font-black uppercase tracking-widest text-muted-custom">
                Configured slabs · highest match wins
              </div>
              <div className="space-y-2">
                {rules.mainIncentive.slab.slabs.map((slab, index) => {
                  const threshold =
                    rules.mainIncentive.slab!.thresholdType ===
                      "fixed_amount" && "minimumBase" in slab
                      ? slab.minimumBase
                      : "minimumMultiplier" in slab
                        ? slab.minimumMultiplier * main.salaryUsed
                        : 0;
                  const achieved =
                    threshold ===
                    (achievedSlab &&
                      (rules.mainIncentive.slab!.thresholdType ===
                        "fixed_amount" && "minimumBase" in achievedSlab
                        ? achievedSlab.minimumBase
                        : "minimumMultiplier" in achievedSlab
                          ? achievedSlab.minimumMultiplier * main.salaryUsed
                          : -1));
                  return (
                    <div
                      key={index}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${achieved ? "border-accent-custom bg-orange-50" : "border-border-custom bg-card-bg"}`}
                    >
                      <span className="font-mono font-bold">
                        {money(threshold)}
                      </span>
                      <span className="font-black">{percent(slab.rate)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 border-t border-border-custom pt-3 text-xs">
                <div className="flex justify-between">
                  <span>Current recognized base</span>
                  <strong>{money(main.currentRecognizedBase)}</strong>
                </div>
                <div className="mt-2 flex justify-between text-accent-custom">
                  <span>Main incentive</span>
                  <strong>{money(main.incentive)}</strong>
                </div>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <CustomerEventBox
          title="New customers"
          events={newCustomerEvents}
          emptyDetail="No new-customer events for this employee and month."
          customerNames={customerNames}
          invoiceNameByMoveId={invoiceNameByMoveId}
          paidEventIds={paidNew}
          qualifiedEventIds={qualifiedNew}
          bonusPerCustomer={rules.newCustomer.bonusPerCustomer}
          maximumPayouts={null}
          payoutCounts={result.stateAfter.repeatPayoutCountsByCustomer}
        />
        <CustomerEventBox
          title="Repeat customers · eligible"
          events={eligibleRepeatEvents}
          emptyDetail="No repeat customers earned a repeat bonus."
          customerNames={customerNames}
          invoiceNameByMoveId={invoiceNameByMoveId}
          paidEventIds={paidRepeat}
          qualifiedEventIds={qualifiedRepeat}
          bonusPerCustomer={rules.repeatCustomer.bonusPerCustomer}
          maximumPayouts={rules.repeatCustomer.maximumPayoutsPerCustomer}
          payoutCounts={result.stateAfter.repeatPayoutCountsByCustomer}
        />
        <CustomerEventBox
          title="Repeat customers · not eligible"
          events={ineligibleRepeatEvents}
          emptyDetail="Every repeat customer event earned the configured bonus."
          customerNames={customerNames}
          invoiceNameByMoveId={invoiceNameByMoveId}
          paidEventIds={paidRepeat}
          qualifiedEventIds={qualifiedRepeat}
          bonusPerCustomer={rules.repeatCustomer.bonusPerCustomer}
          maximumPayouts={rules.repeatCustomer.maximumPayoutsPerCustomer}
          payoutCounts={result.stateAfter.repeatPayoutCountsByCustomer}
        />
      </div>

      <div
        className={`grid gap-4 ${main.structure === "flat" ? "" : "lg:grid-cols-2"}`}
      >
        {main.structure !== "flat" && (
          <Card title="Adjustments">{adjustmentsContent}</Card>
        )}

        <Card title="Final incentive">
          <div className="space-y-3 p-5 text-sm">
            <ResultLine
              label="Confirmed sales before tax"
              value={result.accounting.netSales}
            />
            <ResultLine
              label="Margin / Actual Base"
              value={result.accounting.actualBase}
            />
            <ResultLine label="Main incentive" value={main.incentive} />
            <ResultLine
              label="New-customer bonus"
              value={result.customerIncentive.newCustomerBonus}
            />
            <ResultLine
              label="Repeat-customer bonus"
              value={result.customerIncentive.repeatCustomerBonus}
            />
            <ResultLine label="Total bonuses" value={totalBonuses} />
            {result.adjustmentTotal !== 0 && (
              <ResultLine
                label="Adjustments"
                value={result.adjustmentTotal}
                signed
              />
            )}
            <div className="border-t-2 border-foreground pt-3">
              <ResultLine
                label="Final incentive"
                value={result.finalIncentive}
                strong
              />
            </div>
            {result.performanceNoticeTriggered && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                Performance notice triggered by the configured
                consecutive-failure rule.
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card title="Invoice actuals used by the engine">
        {invoiceActuals.length === 0 ? (
          <EmptyState
            title="No invoice actuals"
            detail="No posted invoice P&L sources belong to this employee and calculation month."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1450px] w-full text-xs">
              <thead>
                <tr className="border-b border-border-custom bg-background/60 text-left text-[9px] font-black uppercase tracking-wider text-muted-custom">
                  {[
                    "Type",
                    "Date",
                    "Customer invoice",
                    "Sales order",
                    "Customer",
                    "Sales",
                    "COGS",
                    "Gross margin",
                    "Transport",
                    "Loading",
                    "Adjusted GM",
                    "GM %",
                  ].map((heading) => (
                    <th
                      key={heading}
                      className={`px-3 py-3 ${["Sales", "COGS", "Gross margin", "Transport", "Loading", "Adjusted GM", "GM %"].includes(heading) ? "text-right" : ""}`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoiceActuals.map((item) => (
                  <tr
                    key={item.moveId}
                    className="border-b border-border-custom/70"
                  >
                    <td className="whitespace-nowrap px-3 py-3 font-bold">
                      {item.type}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {date(item.date)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono font-bold text-cyan-700">
                      {item.invoice}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono">
                      {item.salesOrders.join(", ") || "—"}
                    </td>
                    <td className="px-3 py-3 font-semibold">{item.customer}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
                      {money(item.sales)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
                      {money(item.cogs)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
                      {money(item.grossMargin)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
                      {money(item.transport)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
                      {money(item.loading)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-black">
                      {money(item.adjustedGrossMargin)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono">
                      {percent(item.marginPercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Source audit">
        {visibleSources.length === 0 ? (
          <EmptyState
            title="No persisted sources"
            detail="No accounting or customer sources belong to this employee and calculation month."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[950px] w-full text-xs">
              <thead>
                <tr className="border-b border-border-custom bg-background/60 text-left text-[9px] font-black uppercase tracking-wider text-muted-custom">
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Document</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Source</th>
                  <th className="px-3 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visibleSources.map(
                  ({ source, sourceDate, document, customer }) => (
                    <tr
                      key={source.id}
                      className="border-b border-border-custom/70"
                    >
                      <td className="px-3 py-3">
                        <Badge value={source.x_source_category} />
                      </td>
                      <td className="px-3 py-3">
                        {sourceDate ? date(sourceDate) : "—"}
                      </td>
                      <td className="px-3 py-3 font-bold">{document}</td>
                      <td className="px-3 py-3">{customer}</td>
                      <td className="px-3 py-3 font-mono">
                        {source.x_source_model} #{source.x_source_record_id}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold">
                        {money(source.x_signed_amount)}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canRecordPayment(actor) &&
        detail.x_state === "approved" &&
        detail.x_paid_amount < detail.x_final_incentive && (
          <Card title="Record payment">
            <form
              className="grid gap-3 p-4 md:grid-cols-5"
              onSubmit={(event) => {
                event.preventDefault();
                void action("Payment", async () => {
                  await request(
                    `/api/incentives/calculations/${calculationId}/payments`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        ...payment,
                        amount: Number(payment.amount),
                      }),
                    },
                  );
                });
              }}
            >
              <Field label="Payment date">
                <input
                  type="date"
                  required
                  value={payment.paymentDate}
                  onChange={(event) =>
                    setPayment({ ...payment, paymentDate: event.target.value })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Amount">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={payment.amount}
                  onChange={(event) =>
                    setPayment({ ...payment, amount: event.target.value })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Mode">
                <select
                  value={payment.mode}
                  onChange={(event) =>
                    setPayment({ ...payment, mode: event.target.value })
                  }
                  className={inputClass}
                >
                  <option>Bank Transfer</option>
                  <option>Payroll</option>
                  <option>Cash</option>
                  <option>Other</option>
                </select>
              </Field>
              <Field label="Reference">
                <input
                  required
                  value={payment.reference}
                  onChange={(event) =>
                    setPayment({ ...payment, reference: event.target.value })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Notes">
                <input
                  value={payment.notes}
                  onChange={(event) =>
                    setPayment({ ...payment, notes: event.target.value })
                  }
                  className={inputClass}
                />
              </Field>
              <button
                disabled={!!pending}
                className={`${buttonClass} md:col-span-5`}
              >
                Record payment
              </button>
            </form>
          </Card>
        )}

      {detail.payments.length > 0 && (
        <Card title="Payment history">
          <div className="divide-y divide-border-custom">
            {detail.payments.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-2 gap-2 px-4 py-3 text-xs md:grid-cols-6"
              >
                <span>{date(item.x_payment_date)}</span>
                <strong className="font-mono">{money(item.x_amount)}</strong>
                <span>{item.x_reference}</span>
                <span>{item.x_notes || "—"}</span>
                <span>{relationName(item.x_recorded_by_id)}</span>
                <Badge value={item.x_status} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </main>
  );
}

function CustomerEventBox({
  title,
  events,
  emptyDetail,
  customerNames,
  invoiceNameByMoveId,
  paidEventIds,
  qualifiedEventIds,
  bonusPerCustomer,
  maximumPayouts,
  payoutCounts,
}: {
  title: string;
  events: NormalizedCustomerEvent[];
  emptyDetail: string;
  customerNames: Map<number, string>;
  invoiceNameByMoveId: Map<number, string>;
  paidEventIds: Set<string>;
  qualifiedEventIds: Set<string>;
  bonusPerCustomer: number;
  maximumPayouts: number | null | undefined;
  payoutCounts: Record<string, number>;
}) {
  return (
    <Card title={`${title} · ${events.length}`}>
      {events.length === 0 ? (
        <EmptyState title="None" detail={emptyDetail} />
      ) : (
        <div className="max-h-[430px] divide-y divide-border-custom/70 overflow-y-auto">
          {events.map((event) => {
            const paid = paidEventIds.has(event.id);
            const qualified = qualifiedEventIds.has(event.id);
            const invoiceNumbers = event.invoiceNumbers?.length
              ? event.invoiceNumbers.join(", ")
              : (invoiceNameByMoveId.get(
                  Number(event.id.split(":").slice(-1)[0]),
                ) ?? `#${event.id.split(":").slice(-1)[0]}`);
            const payoutCount = payoutCounts[String(event.customerId)] ?? 0;
            const status = paid
              ? "bonus included"
              : qualified
                ? "payout limit reached"
                : "not eligible";

            return (
              <div key={event.id} className="space-y-3 p-4 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold">
                      {customerNames.get(event.customerId) ??
                        `Customer ${event.customerId}`}
                    </div>
                    <div className="mt-1 font-mono text-[10px] font-bold text-cyan-700">
                      {invoiceNumbers}
                    </div>
                  </div>
                  <Badge value={status} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px]">
                  <EventValue
                    label="Event date"
                    value={date(event.eventDate)}
                  />
                  <EventValue
                    label="Billing"
                    value={moneyDetailed(event.billing)}
                  />
                  <EventValue
                    label="Gross margin"
                    value={moneyDetailed(event.grossMargin)}
                  />
                  <EventValue
                    label={
                      event.kind === "repeat_customer"
                        ? "Payout count"
                        : "Bonus"
                    }
                    value={
                      event.kind === "repeat_customer"
                        ? `${payoutCount} / ${maximumPayouts ?? "∞"}`
                        : moneyDetailed(paid ? bonusPerCustomer : 0)
                    }
                  />
                </div>
                {event.kind === "repeat_customer" && (
                  <div className="flex items-center justify-between border-t border-border-custom/60 pt-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-custom">
                      Repeat bonus
                    </span>
                    <span className="font-mono font-black">
                      {moneyDetailed(paid ? bonusPerCustomer : 0)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function EventValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-bold uppercase tracking-wider text-muted-custom">
        {label}
      </div>
      <div className="mt-0.5 font-mono font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-border-custom/60 pb-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-custom">
        {label}
      </div>
      <div className="mt-1 font-semibold text-foreground">{value}</div>
    </div>
  );
}
function Explanation({ lines }: { lines: Array<[string, string]> }) {
  return (
    <div className="rounded-lg border border-border-custom bg-foreground p-4 text-background">
      <div className="mb-3 text-[9px] font-black uppercase tracking-widest text-background/60">
        Engine explanation
      </div>
      <div className="space-y-2">
        {lines.map(([label, value], index) => (
          <div
            key={label}
            className={`flex justify-between text-xs ${index === lines.length - 1 ? "border-t border-background/20 pt-3 text-sm font-black" : ""}`}
          >
            <span>{label}</span>
            <span className="font-mono font-bold">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function ResultLine({
  label,
  value,
  signed = false,
  strong = false,
}: {
  label: string;
  value: number;
  signed?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${strong ? "text-lg font-black" : ""}`}
    >
      <span>{label}</span>
      <span className="font-mono font-black tabular-nums">
        {signed && value > 0 ? "+" : ""}
        {moneyDetailed(value)}
      </span>
    </div>
  );
}

function moneyDetailed(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-[9px] font-bold uppercase tracking-wider text-muted-custom">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
