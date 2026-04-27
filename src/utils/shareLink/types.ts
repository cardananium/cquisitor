import type { NetworkType, PlutusDataSchema } from "@cardananium/cquisitor-lib";
import type { FetchedValidationData } from "@/utils/transactionValidation";

export type TabId = "transaction-validator" | "cardano-cbor" | "general-cbor" | "cddl-validator";

export type ShareLinkMode =
  | { kind: "minimal" }
  | { kind: "readable" }
  | { kind: "compressed" };

export interface ValidatorShareInput {
  cbor: string;
  net: NetworkType;
  ctx?: FetchedValidationData;
  capturedAt?: number;
}

export interface CardanoCborShareInput {
  cbor: string;
  net: NetworkType;
  type?: string | null;
  psv?: number | null;
  pds?: PlutusDataSchema | null;
}

export interface GeneralCborShareInput {
  cbor: string;
}

export interface ValidatorRichPayloadV1 {
  ctx_v: number;
  cbor: string;
  net: NetworkType;
  capturedAt?: number;
  ctx?: FetchedValidationData;
}

export interface ParsedValidatorShare {
  cbor?: string;
  net?: NetworkType;
  ctx?: FetchedValidationData;
  capturedAt?: number;
  ctxIncompatible?: boolean;
  futureVersion?: boolean;
  parseError?: string;
}

export interface ParsedCardanoCborShare {
  cbor?: string;
  net?: NetworkType;
  type?: string;
  psv?: number;
  pds?: PlutusDataSchema;
  futureVersion?: boolean;
  parseError?: string;
}

export interface ParsedGeneralCborShare {
  cbor?: string;
  futureVersion?: boolean;
  parseError?: string;
}
