import type { OdooGateway } from './gateway';
import {
  INCENTIVE_STUDIO_MODEL_DEFINITIONS,
  type StudioFieldDefinition,
  type StudioSchemaStatus,
  inspectIncentiveStudioSchema,
  studioSelectionLiteral,
} from './studio-schema';

export const INCENTIVE_ROLE_GROUPS = {
  employee: 'Sunlectric Incentives / Employee',
  reviewer: 'Sunlectric Incentives / Reviewer',
  approver: 'Sunlectric Incentives / Approver',
  administrator: 'Sunlectric Incentives / Administrator',
  paymentRecorder: 'Sunlectric Incentives / Payment Recorder',
} as const;

type IncentiveRole = keyof typeof INCENTIVE_ROLE_GROUPS;

interface IrModelRecord {
  id: number;
  model: string;
}

interface NamedRecord {
  id: number;
  name: string;
}

interface ModelFieldRecord {
  id: number;
  model: string;
  name: string;
  required: boolean;
}

interface ProvisioningResult {
  createdModels: string[];
  createdFields: string[];
  createdGroups: string[];
  createdAccessControls: string[];
  createdRecordRules: string[];
  schema: StudioSchemaStatus;
}

const MODEL_KEYS = Object.fromEntries(
  Object.keys(INCENTIVE_STUDIO_MODEL_DEFINITIONS).map((model) => [
    model,
    model.replace('x_sunlectric_incentive_', '').replaceAll('_', '-'),
  ]),
);

const ROLE_ACCESS: Record<IncentiveRole, Record<string, 'r' | 'rwcu'>> = {
  employee: {
    x_sunlectric_incentive_preset: 'r',
    x_sunlectric_incentive_preset_version: 'r',
    x_sunlectric_incentive_assignment: 'r',
    x_sunlectric_incentive_calculation: 'r',
    x_sunlectric_incentive_calculation_source: 'r',
    x_sunlectric_incentive_payment: 'r',
  },
  reviewer: Object.fromEntries(
    Object.keys(INCENTIVE_STUDIO_MODEL_DEFINITIONS).map((model) => [
      model,
      [
        'x_sunlectric_incentive_expense_assignment',
        'x_sunlectric_incentive_commission_assignment',
        'x_sunlectric_incentive_owner_resolution',
        'x_sunlectric_incentive_adjustment',
      ].includes(model) ? 'rwcu' : 'r',
    ]),
  ),
  approver: {},
  administrator: Object.fromEntries(
    Object.keys(INCENTIVE_STUDIO_MODEL_DEFINITIONS).map((model) => [model, 'rwcu']),
  ),
  paymentRecorder: {
    x_sunlectric_incentive_calculation: 'r',
    x_sunlectric_incentive_calculation_source: 'r',
    x_sunlectric_incentive_payment: 'rwcu',
  },
};

const RECORD_RULES = [
  {
    name: 'Sunlectric incentive locked preset versions are immutable',
    model: 'x_sunlectric_incentive_preset_version',
    domain: "[('x_locked', '=', False)]",
    permissions: { write: true, unlink: true },
  },
  {
    name: 'Sunlectric incentive approved calculations are immutable',
    model: 'x_sunlectric_incentive_calculation',
    domain: "[('x_state', 'not in', ['approved', 'superseded'])]",
    permissions: { write: true, unlink: true },
  },
  {
    name: 'Sunlectric incentive approved adjustments are immutable',
    model: 'x_sunlectric_incentive_adjustment',
    domain: "[('x_calculation_id.x_state', 'not in', ['approved', 'superseded'])]",
    permissions: { create: true, write: true, unlink: true },
  },
  {
    name: 'Sunlectric incentive approved source audits are immutable',
    model: 'x_sunlectric_incentive_calculation_source',
    domain: "[('x_calculation_id.x_state', 'not in', ['approved', 'superseded'])]",
    permissions: { create: true, write: true, unlink: true },
  },
  {
    name: 'Sunlectric incentive payments require approved calculations',
    model: 'x_sunlectric_incentive_payment',
    domain: "[('x_calculation_id.x_state', '=', 'approved')]",
    permissions: { create: true, write: true },
  },
] as const;

const EMPLOYEE_RECORD_RULES = [
  {
    name: 'Sunlectric incentive employee own assignments',
    model: 'x_sunlectric_incentive_assignment',
    domain: "[('x_employee_id.user_id', '=', user.id)]",
  },
  {
    name: 'Sunlectric incentive employee own calculations',
    model: 'x_sunlectric_incentive_calculation',
    domain: "[('x_employee_id.user_id', '=', user.id)]",
  },
  {
    name: 'Sunlectric incentive employee own sources',
    model: 'x_sunlectric_incentive_calculation_source',
    domain: "[('x_calculation_id.x_employee_id.user_id', '=', user.id)]",
  },
  {
    name: 'Sunlectric incentive employee own payments',
    model: 'x_sunlectric_incentive_payment',
    domain: "[('x_calculation_id.x_employee_id.user_id', '=', user.id)]",
  },
] as const;

function fieldValues(
  modelId: number,
  name: string,
  definition: StudioFieldDefinition,
): Record<string, unknown> {
  return {
    model_id: modelId,
    name,
    field_description: definition.label,
    ttype: definition.type,
    required: definition.required ?? false,
    readonly: definition.readonly ?? false,
    index: definition.index ?? false,
    copied: definition.copied ?? true,
    ...(definition.relation ? { relation: definition.relation } : {}),
    ...(definition.onDelete ? { on_delete: definition.onDelete } : {}),
    ...(definition.currencyField ? { currency_field: definition.currencyField } : {}),
    ...(definition.selection ? { selection: studioSelectionLiteral(definition.selection) } : {}),
  };
}

async function loadModels(gateway: OdooGateway): Promise<Map<string, number>> {
  const names = Object.keys(INCENTIVE_STUDIO_MODEL_DEFINITIONS);
  const records = await gateway.searchReadAll<IrModelRecord>(
    'ir.model',
    [['model', 'in', names]],
    ['id', 'model'],
  );
  return new Map(records.map((record) => [record.model, record.id]));
}

async function requireGeneratedNameFields(gateway: OdooGateway): Promise<void> {
  const records = await gateway.searchReadAll<ModelFieldRecord>(
    'ir.model.fields',
    [
      ['model', 'in', Object.keys(INCENTIVE_STUDIO_MODEL_DEFINITIONS)],
      ['name', '=', 'x_name'],
      ['required', '=', false],
    ],
    ['id', 'model', 'name', 'required'],
  );
  for (const record of records) {
    await gateway.write('ir.model.fields', [record.id], { required: true });
  }
}

async function createModelsAndFields(
  gateway: OdooGateway,
): Promise<Pick<ProvisioningResult, 'createdModels' | 'createdFields'>> {
  const initial = await inspectIncentiveStudioSchema(gateway);
  const nonNameMismatches = initial.fieldMismatches.filter((mismatch) => !(
    mismatch.field === 'x_name'
    && mismatch.property === 'required'
    && mismatch.expected === true
    && mismatch.actual === false
  ));
  if (nonNameMismatches.length > 0) {
    throw new Error(`Live Studio field mismatch: ${JSON.stringify(nonNameMismatches)}`);
  }
  const createdModels: string[] = [];
  const createdFields: string[] = [];
  for (const model of initial.missingModels) {
    const definition = INCENTIVE_STUDIO_MODEL_DEFINITIONS[model];
    await gateway.create<number[]>('ir.model', [{ name: definition.name, model }]);
    createdModels.push(model);
  }

  await requireGeneratedNameFields(gateway);

  const modelIds = await loadModels(gateway);
  const afterModels = await inspectIncentiveStudioSchema(gateway);
  for (const missing of afterModels.missingFields) {
    if (missing.field === 'x_name') {
      throw new Error(`${missing.model} was created without its required x_name field`);
    }
    const modelId = modelIds.get(missing.model);
    if (!modelId) {
      throw new Error(`Cannot create ${missing.model}.${missing.field}: model is missing`);
    }
    const definition = INCENTIVE_STUDIO_MODEL_DEFINITIONS[missing.model].fields[missing.field];
    await gateway.create<number[]>('ir.model.fields', [
      fieldValues(modelId, missing.field, definition),
    ]);
    createdFields.push(`${missing.model}.${missing.field}`);
  }
  return { createdModels, createdFields };
}

async function createGroups(
  gateway: OdooGateway,
): Promise<{ ids: Record<IncentiveRole, number>; created: string[] }> {
  const names = Object.values(INCENTIVE_ROLE_GROUPS);
  const existing = await gateway.searchReadAll<NamedRecord>(
    'res.groups',
    [['name', 'in', names]],
    ['id', 'name'],
  );
  const idsByName = new Map(existing.map((record) => [record.name, record.id]));
  const created: string[] = [];
  for (const name of names) {
    if (!idsByName.has(name)) {
      const ids = await gateway.create<number[]>('res.groups', [{ name, share: false }]);
      idsByName.set(name, ids[0]);
      created.push(name);
    }
  }
  const ids = Object.fromEntries(
    Object.entries(INCENTIVE_ROLE_GROUPS).map(([role, name]) => [role, idsByName.get(name)!]),
  ) as Record<IncentiveRole, number>;

  await gateway.write('res.groups', [ids.approver], {
    implied_ids: [[4, ids.reviewer]],
  });
  await gateway.write('res.groups', [ids.administrator], {
    implied_ids: [[4, ids.approver], [4, ids.paymentRecorder]],
  });
  return { ids, created };
}

async function createAccessControls(
  gateway: OdooGateway,
  modelIds: Map<string, number>,
  groupIds: Record<IncentiveRole, number>,
): Promise<string[]> {
  const names = Object.entries(ROLE_ACCESS).flatMap(([role, access]) => (
    Object.keys(access).map((model) => `sunlectric-incentive-${role}-${MODEL_KEYS[model]}`)
  ));
  const existing = await gateway.searchReadAll<NamedRecord>(
    'ir.model.access',
    [['name', 'in', names]],
    ['id', 'name'],
  );
  const existingByName = new Map(existing.map((record) => [record.name, record.id]));
  const created: string[] = [];
  for (const [role, accessByModel] of Object.entries(ROLE_ACCESS) as Array<[
    IncentiveRole,
    Record<string, 'r' | 'rwcu'>,
  ]>) {
    for (const [model, permissions] of Object.entries(accessByModel)) {
      const name = `sunlectric-incentive-${role}-${MODEL_KEYS[model]}`;
      const values = {
        name,
        model_id: modelIds.get(model),
        group_id: groupIds[role],
        perm_read: permissions.includes('r'),
        perm_write: permissions.includes('w'),
        perm_create: permissions.includes('c'),
        perm_unlink: permissions.includes('u'),
        active: true,
      };
      const existingId = existingByName.get(name);
      if (existingId) {
        await gateway.write('ir.model.access', [existingId], values);
      } else {
        await gateway.create<number[]>('ir.model.access', [values]);
        created.push(name);
      }
    }
  }
  return created;
}

async function createRecordRules(
  gateway: OdooGateway,
  modelIds: Map<string, number>,
  groupIds: Record<IncentiveRole, number>,
): Promise<string[]> {
  const names = [
    ...RECORD_RULES.map((rule) => rule.name),
    ...EMPLOYEE_RECORD_RULES.map((rule) => rule.name),
  ];
  const existing = await gateway.searchReadAll<NamedRecord>(
    'ir.rule',
    [['name', 'in', names]],
    ['id', 'name'],
  );
  const existingNames = new Set(existing.map((record) => record.name));
  const created: string[] = [];
  for (const rule of RECORD_RULES) {
    if (existingNames.has(rule.name)) {
      continue;
    }
    await gateway.create<number[]>('ir.rule', [{
      name: rule.name,
      model_id: modelIds.get(rule.model),
      domain_force: rule.domain,
      perm_read: false,
      perm_write: rule.permissions.write ?? false,
      perm_create: 'create' in rule.permissions ? rule.permissions.create : false,
      perm_unlink: 'unlink' in rule.permissions ? rule.permissions.unlink : false,
      active: true,
    }]);
    created.push(rule.name);
  }
  for (const rule of EMPLOYEE_RECORD_RULES) {
    if (existingNames.has(rule.name)) {
      continue;
    }
    await gateway.create<number[]>('ir.rule', [{
      name: rule.name,
      model_id: modelIds.get(rule.model),
      groups: [[6, 0, [groupIds.employee]]],
      domain_force: rule.domain,
      perm_read: true,
      perm_write: false,
      perm_create: false,
      perm_unlink: false,
      active: true,
    }]);
    created.push(rule.name);
  }
  return created;
}

export async function provisionIncentiveStudio(
  gateway: OdooGateway,
  apiUserId: number,
): Promise<ProvisioningResult> {
  const schemaChanges = await createModelsAndFields(gateway);
  const schema = await inspectIncentiveStudioSchema(gateway);
  if (!schema.ready) {
    throw new Error(`Studio schema verification failed: ${JSON.stringify(schema)}`);
  }
  const groups = await createGroups(gateway);
  const modelIds = await loadModels(gateway);
  const createdAccessControls = await createAccessControls(gateway, modelIds, groups.ids);
  const createdRecordRules = await createRecordRules(gateway, modelIds, groups.ids);
  await gateway.write('res.users', [apiUserId], {
    group_ids: [[4, groups.ids.administrator]],
  });
  return {
    ...schemaChanges,
    createdGroups: groups.created,
    createdAccessControls,
    createdRecordRules,
    schema,
  };
}
