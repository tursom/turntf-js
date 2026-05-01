import {
  DeliveryMode,
  type Message,
  type MessageCursor,
  type ScanUserMetadataRequest,
  type SessionRef,
  type UserRef
} from "./types";

const unsignedDecimalPattern = /^(0|[1-9][0-9]*)$/;
const userMetadataKeyPattern = /^[A-Za-z0-9._:-]*$/;
const userMetadataKeyMaxLength = 128;
const userMetadataScanLimitMax = 1000;

export function assertDecimalString(value: string, field: string): void {
  if (!unsignedDecimalPattern.test(value)) {
    throw new Error(`${field} must be a decimal string`);
  }
}

export function assertRequiredDecimalString(value: string, field: string): void {
  assertDecimalString(value, field);
  if (value === "0") {
    throw new Error(`${field} is required`);
  }
}

export function validateUserRef(ref: UserRef, field = "user"): void {
  assertRequiredDecimalString(ref.nodeId, `${field}.nodeId`);
  assertRequiredDecimalString(ref.userId, `${field}.userId`);
}

export function validateSessionRef(ref: SessionRef, field = "session"): void {
  assertRequiredDecimalString(ref.servingNodeId, `${field}.servingNodeId`);
  if (ref.sessionId === "") {
    throw new Error(`${field}.sessionId is required`);
  }
}

export function validateDeliveryMode(mode: DeliveryMode): void {
  if (mode !== DeliveryMode.BestEffort && mode !== DeliveryMode.RouteRetry) {
    throw new Error(`invalid deliveryMode ${JSON.stringify(mode)}`);
  }
}

export function validateLimit(value: number, field: string, max?: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  if (max != null && value > max) {
    throw new Error(`${field} cannot exceed ${max}`);
  }
}

export function validateUserMetadataKey(value: string, field = "key"): void {
  validateUserMetadataKeyFragment(value, field, false);
}

export function validateUserMetadataKeyFragment(value: string, field: string, allowEmpty: boolean): void {
  if (value === "") {
    if (allowEmpty) {
      return;
    }
    throw new Error(`${field} is required`);
  }
  if (value.length > userMetadataKeyMaxLength) {
    throw new Error(`${field} cannot exceed ${userMetadataKeyMaxLength} characters`);
  }
  if (!userMetadataKeyPattern.test(value)) {
    throw new Error(`${field} contains unsupported characters`);
  }
}

export function validateUserMetadataScanRequest(request: ScanUserMetadataRequest, field = "request"): void {
  validateUserMetadataKeyFragment(request.prefix ?? "", `${field}.prefix`, true);
  validateUserMetadataKeyFragment(request.after ?? "", `${field}.after`, true);
  if (request.limit != null) {
    validateLimit(request.limit, `${field}.limit`, userMetadataScanLimitMax);
  }
  if (
    request.prefix != null &&
    request.prefix !== "" &&
    request.after != null &&
    request.after !== "" &&
    !request.after.startsWith(request.prefix)
  ) {
    throw new Error(`${field}.after must use the same prefix as ${field}.prefix`);
  }
}

export function cursorForMessage(message: Message): MessageCursor {
  return { nodeId: message.nodeId, seq: message.seq };
}

export function toWireInteger(value: string, field: string): bigint {
  assertDecimalString(value, field);
  return BigInt(value);
}

export function toRequiredWireInteger(value: string, field: string): bigint {
  assertRequiredDecimalString(value, field);
  return BigInt(value);
}

export function idToString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`invalid integer value ${value}`);
    }
    return String(value);
  }
  if (value == null) {
    return "0";
  }
  return String(value);
}
