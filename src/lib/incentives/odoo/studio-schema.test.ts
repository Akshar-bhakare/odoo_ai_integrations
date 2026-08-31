import { describe, expect, it } from 'vitest';
import type { OdooGateway } from './gateway';
import {
  INCENTIVE_STUDIO_FIELDS,
  INCENTIVE_STUDIO_MODEL_DEFINITIONS,
  INCENTIVE_STUDIO_MODELS,
  inspectIncentiveStudioSchema,
} from './studio-schema';

function schemaGateway(missingField?: string): OdooGateway {
  return {
    async searchCount() {
      return 0;
    },
    async searchRead() {
      return [];
    },
    async searchReadAll<T>(model: string) {
      if (model === 'ir.model') {
        return Object.values(INCENTIVE_STUDIO_MODELS).map((technicalName, index) => ({
          id: index + 1,
          model: technicalName,
        })) as T[];
      }
      if (model === 'ir.model.fields') {
        return Object.entries(INCENTIVE_STUDIO_FIELDS).flatMap(([technicalName, fields]) => (
          fields
            .filter((field) => `${technicalName}.${field}` !== missingField)
            .map((field) => {
              const definition = INCENTIVE_STUDIO_MODEL_DEFINITIONS[technicalName].fields[field];
              return {
                model: technicalName,
                name: field,
                ttype: definition.type,
                relation: definition.relation ?? false,
                required: definition.required ?? false,
                readonly: definition.readonly ?? false,
                on_delete: definition.onDelete ?? false,
                currency_field: definition.currencyField ?? false,
                selection: definition.selection
                  ? `[${definition.selection.map(([value, label]) => `('${value}', '${label}')`).join(', ')}]`
                  : false,
              };
            })
        )) as T[];
      }
      return [];
    },
    async create<T>() {
      return [] as T;
    },
    async write() {
      return true;
    },
    async unlink() {
      return true;
    },
  };
}

describe('Studio schema inspection', () => {
  it('reports ready only when every model and required field exists', async () => {
    await expect(inspectIncentiveStudioSchema(schemaGateway())).resolves.toEqual({
      ready: true,
      missingModels: [],
      missingFields: [],
      fieldMismatches: [],
    });
  });

  it('reports an exact missing Studio field', async () => {
    const missing = `${INCENTIVE_STUDIO_MODELS.commissionAssignment}.x_employee_id`;
    const status = await inspectIncentiveStudioSchema(schemaGateway(missing));

    expect(status.ready).toBe(false);
    expect(status.missingFields).toContainEqual({
      model: INCENTIVE_STUDIO_MODELS.commissionAssignment,
      field: 'x_employee_id',
    });
  });
});
