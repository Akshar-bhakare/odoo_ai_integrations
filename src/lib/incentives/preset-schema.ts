import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import presetSchema from '../../../docs/incentives/preset.schema.json';
import type { IncentivePresetV1 } from './types';

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(presetSchema);

export class IncentivePresetSchemaError extends Error {
  readonly errors: ErrorObject[];

  constructor(errors: ErrorObject[]) {
    super(`Preset JSON does not match preset.schema.json: ${ajv.errorsText(errors)}`);
    this.name = 'IncentivePresetSchemaError';
    this.errors = errors;
  }
}

export function assertPresetSchema(value: unknown): asserts value is IncentivePresetV1 {
  if (!validate(value)) {
    throw new IncentivePresetSchemaError([...(validate.errors ?? [])]);
  }
}
