/* Ultron C06: model-authored provider function with separately owned authority fence. */
function fix(input) {
    const { providerStatus, receiptVerified } = input;

    if (providerStatus === 'unknown' || providerStatus === 'timeout') {
        return 'reconcile';
    }

    if (providerStatus === 'observed' && receiptVerified === true) {
        return 'verified';
    }

    return 'held';
}
export function classifyC06Effect(input) {
 if (!input || typeof input !== 'object' || Array.isArray(input) ||
  input.authorized !== true || input.paused !== false ||
  !Number.isInteger(input.paidCents) || input.paidCents !== 0) return 'held';
 return fix({providerStatus:input.providerStatus,receiptVerified:input.receiptVerified});
}
