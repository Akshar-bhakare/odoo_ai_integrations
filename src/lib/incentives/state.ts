import type { CalculationState } from './types';

export function createInitialCalculationState(): CalculationState {
  return {
    lastProcessedMonth: null,
    carryShortfall: 0,
    accumulatedUnpaidBase: 0,
    consecutiveFailureCount: 0,
    cycleSequence: 0,
    lastRecognitionMonth: null,
    recognizedCustomerEventIds: [],
    repeatPayoutCountsByCustomer: {},
  };
}

export function cloneCalculationState(state: CalculationState): CalculationState {
  return {
    ...state,
    recognizedCustomerEventIds: [...state.recognizedCustomerEventIds],
    repeatPayoutCountsByCustomer: { ...state.repeatPayoutCountsByCustomer },
  };
}
