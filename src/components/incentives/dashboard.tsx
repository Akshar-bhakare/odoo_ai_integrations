"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import type {
  AssignmentRecord,
  CalculationSummaryRecord,
  EmployeeRecord,
  PresetRecord,
} from "@/lib/incentives/ui/types";
import {
  employeesWithEffectiveAssignment,
  type DashboardRow,
} from "@/lib/incentives/ui/view-model";
import { money, monthLabel } from "@/lib/incentives/ui/format";
import { canReview } from "@/lib/incentives/ui/permissions";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function IncentiveDashboard() {
  const { actor, request } = useIncentiveSession();
  const router = useRouter();
  const [calculations, setCalculations] = useState<CalculationSummaryRecord[]>(
    [],
  );
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [presets, setPresets] = useState<PresetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("");
  const [presetFilter, setPresetFilter] = useState("all");
  const [eligibilityFilter, setEligibilityFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [createEmployee, setCreateEmployee] = useState("");
  const [createMonth, setCreateMonth] = useState(currentMonth());
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request<{
        calculations: CalculationSummaryRecord[];
        employees: EmployeeRecord[];
        presets: PresetRecord[];
        assignments: AssignmentRecord[];
      }>("/api/incentives/dashboard");
      setCalculations(data.calculations);
      setEmployees(data.employees);
      setPresets(data.presets);
      setAssignments(data.assignments);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load calculations",
      );
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const worker = new Worker(
      new URL("./dashboard.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<DashboardRow[]>) =>
      setRows(event.data);
    worker.postMessage(calculations);
    return () => worker.terminate();
  }, [calculations]);
  const calculableEmployees = useMemo(
    () => employeesWithEffectiveAssignment(employees, assignments, createMonth),
    [assignments, createMonth, employees],
  );
  const effectiveCreateEmployee = calculableEmployees.some(
    (employee) => String(employee.id) === createEmployee,
  )
    ? createEmployee
    : String(calculableEmployees[0]?.id ?? "");
  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (employeeFilter === "all" || row.employee === employeeFilter) &&
          (!monthFilter || row.month === monthFilter) &&
          (presetFilter === "all" || row.presetVersion === presetFilter) &&
          (eligibilityFilter === "all" ||
            String(row.eligible) === eligibilityFilter) &&
          (stateFilter === "all" || row.state === stateFilter),
      ),
    [
      eligibilityFilter,
      employeeFilter,
      monthFilter,
      presetFilter,
      rows,
      stateFilter,
    ],
  );

  const totals = useMemo(
    () =>
      filtered.reduce(
        (summary, row) => ({
          actualBase: summary.actualBase + row.actualBase,
          main: summary.main + row.mainIncentive,
          customer: summary.customer + row.newCustomerBonus + row.repeatBonus,
          final: summary.final + row.finalIncentive,
        }),
        { actualBase: 0, main: 0, customer: 0, final: 0 },
      ),
    [filtered],
  );

  async function createCalculation() {
    if (!effectiveCreateEmployee || !createMonth) return;
    setCreating(true);
    setError("");
    try {
      const result = await request<{ calculationId: number }>(
        "/api/incentives/calculations",
        {
          method: "POST",
          body: JSON.stringify({
            employeeId: Number(effectiveCreateEmployee),
            month: createMonth,
          }),
        },
      );
      router.push(`/incentives/calculations/${result.calculationId}`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create calculation",
      );
      setCreating(false);
    }
  }

  const employeeNames = [...new Set(rows.map((row) => row.employee))];
  const versionNames = [...new Set(rows.map((row) => row.presetVersion))];

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-4 py-5 md:px-7">
      <div className="flex justify-end">
        {canReview(actor) && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border-custom bg-card-bg p-3">
            <label className="min-w-44 text-[9px] font-bold uppercase tracking-wider text-muted-custom">
              Employee
              <select
                value={effectiveCreateEmployee}
                onChange={(event) => setCreateEmployee(event.target.value)}
                className={`${inputClass} mt-1`}
              >
                {calculableEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[9px] font-bold uppercase tracking-wider text-muted-custom">
              Month
              <input
                type="month"
                value={createMonth}
                onChange={(event) => setCreateMonth(event.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
            <button
              onClick={createCalculation}
              disabled={creating || !effectiveCreateEmployee}
              className={buttonClass}
            >
              {creating ? "Preparing preview…" : "Calculate & preview"}
            </button>
            {calculableEmployees.length === 0 && (
              <span className="basis-full text-[10px] font-semibold text-amber-700">
                No employee has an active preset assignment for this month.
                Configure an assignment before calculating.
              </span>
            )}
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Actual Base" value={money(totals.actualBase)} />
        <Metric label="Main Incentive" value={money(totals.main)} />
        <Metric label="Customer Bonuses" value={money(totals.customer)} />
        <Metric label="Final Incentive" value={money(totals.final)} accent />
      </div>

      <Card
        title="Filters"
        action={
          <button
            onClick={() => {
              setEmployeeFilter("all");
              setMonthFilter("");
              setPresetFilter("all");
              setEligibilityFilter("all");
              setStateFilter("all");
            }}
            className={secondaryButtonClass}
          >
            Reset
          </button>
        }
      >
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
          <Filter label="Employee">
            <select
              value={employeeFilter}
              onChange={(event) => setEmployeeFilter(event.target.value)}
              className={inputClass}
            >
              <option value="all">All employees</option>
              {employeeNames.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </Filter>
          <Filter label="Month">
            <input
              type="month"
              value={monthFilter}
              onChange={(event) => setMonthFilter(event.target.value)}
              className={inputClass}
            />
          </Filter>
          <Filter label="Preset">
            <select
              value={presetFilter}
              onChange={(event) => setPresetFilter(event.target.value)}
              className={inputClass}
            >
              <option value="all">All presets</option>
              {versionNames.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </Filter>
          <Filter label="Status">
            <select
              value={eligibilityFilter}
              onChange={(event) => setEligibilityFilter(event.target.value)}
              className={inputClass}
            >
              <option value="all">All eligibility</option>
              <option value="true">Eligible</option>
              <option value="false">Not eligible</option>
            </select>
          </Filter>
          <Filter label="Calculation state">
            <select
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value)}
              className={inputClass}
            >
              <option value="all">All states</option>
              <option value="draft">Draft</option>
              <option value="review">Review</option>
              <option value="approved">Approved</option>
            </select>
          </Filter>
        </div>
      </Card>

      <Card title={`Calculations · ${filtered.length}`}>
        {loading ? (
          <LoadingState label="Loading incentive calculations…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No calculations found"
            detail={
              presets.length === 0
                ? "No active presets are available. An administrator must create and activate a preset first."
                : "Choose different filters or calculate a month for an assigned employee."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1850px] w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-border-custom bg-background/60 text-left text-[9px] font-black uppercase tracking-wider text-muted-custom">
                  {[
                    "Employee",
                    "Month",
                    "Preset",
                    "Version",
                    "Salary",
                    "Actual Base",
                    "Threshold / First Slab",
                    "Carry In",
                    "Carry Out",
                    "Eligibility",
                    "Main Incentive",
                    "New Customer",
                    "Repeat",
                    "Adjustments",
                    "Final Incentive",
                    "Notice",
                    "State",
                    "Payment",
                  ].map((heading) => (
                    <th key={heading} className="whitespace-nowrap px-3 py-3">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border-custom/70 hover:bg-background/70"
                  >
                    <td className="px-3 py-3 font-bold">
                      <Link
                        href={`/incentives/calculations/${row.id}`}
                        className="hover:text-accent-custom"
                      >
                        {row.employee}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {monthLabel(row.month)}
                    </td>
                    <td
                      className="max-w-48 truncate px-3 py-3"
                      title={row.preset}
                    >
                      {row.preset}
                    </td>
                    <td className="px-3 py-3 text-muted-custom">
                      {row.presetVersion}
                    </td>
                    {[
                      row.salary,
                      row.actualBase,
                      row.normalThreshold,
                      row.carryIn,
                      row.carryOut,
                    ].map((value, index) => (
                      <td
                        key={index}
                        className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums"
                      >
                        {money(value)}
                      </td>
                    ))}
                    <td className="px-3 py-3">
                      <Badge
                        value={row.eligible ? "eligible" : "not eligible"}
                      />
                    </td>
                    {[
                      row.mainIncentive,
                      row.newCustomerBonus,
                      row.repeatBonus,
                      row.adjustments,
                    ].map((value, index) => (
                      <td
                        key={index}
                        className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums"
                      >
                        {money(value)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-black tabular-nums text-accent-custom">
                      {money(row.finalIncentive)}
                    </td>
                    <td className="px-3 py-3">
                      {row.notice ? <Badge value="notice" /> : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge value={row.state} />
                    </td>
                    <td className="px-3 py-3">
                      <Badge value={row.paymentState || "unpaid"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}

function Filter({
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
