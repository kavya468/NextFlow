import { ValidationError } from "../services/errors";
import { BILLING_LIMITS } from "../credits/billing-policy";

export interface DialogueLine { text: string; voice: string }

/** Shared parsing for the worker and provider boundary; no source lines are discarded. */
export function parseDialogueInputs(value: unknown): DialogueLine[] {
  if (Array.isArray(value)) {
    if (value.length > BILLING_LIMITS.dialogueLines || value.some(line => !line || typeof line !== "object" || typeof line.text !== "string" || typeof line.voice !== "string")) {
      throw new ValidationError(`Dialogue must contain at most ${BILLING_LIMITS.dialogueLines} lines with text and voice`);
    }
    return value.map(line => ({ text: line.text, voice: line.voice }));
  }
  if (typeof value !== "string") throw new ValidationError("Dialogue must be text or an array of speaker lines");
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); }
    catch { throw new ValidationError("Dialogue JSON is invalid; use an array of text and voice objects or plain text"); }
    return parseDialogueInputs(parsed);
  }
  const lines = trimmed.split("\n").map(line => line.trim()).filter(Boolean);
  const matches = lines.map(line => /^([A-Za-z][A-Za-z0-9 _-]{0,39}):\s*(.+)$/.exec(line));
  if (matches.every(match => match !== null)) return matches.map(match => ({ voice: match![1].trim(), text: match![2].trim() }));
  const blocks = trimmed.split(/\n\s*\n/).filter(Boolean).map(block => block.split("\n").map(line => line.trim()).filter(Boolean));
  if (blocks.length >= 2 && blocks.every(block => block.length >= 2 && /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/.test(block[0]))) {
    return blocks.map(block => ({ voice: block[0], text: block.slice(1).join(" ") }));
  }
  return lines.map(text => ({ text, voice: "default" }));
}

export function composeDialogueInputs(inputs: Record<string, unknown>): DialogueLine[] {
  const lines = parseDialogueInputs(inputs.inputs);
  for (const [key, value] of Object.entries(inputs)) {
    const match = /^dialogue_text_(0|[1-9]\d*)$/.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isSafeInteger(index) || index >= lines.length) throw new ValidationError(`Dialogue handle ${key} references a missing line; reconnect it to an existing line`);
    if (typeof value !== "string" || !value.trim()) throw new ValidationError(`Dialogue handle ${key} must contain non-empty text`);
    lines[index] = { ...lines[index], text: value };
  }
  if (!lines.length || lines.length > BILLING_LIMITS.dialogueLines || lines.some(line => !line.text.trim() || !line.voice.trim())) {
    throw new ValidationError(`Dialogue must contain 1–${BILLING_LIMITS.dialogueLines} non-empty speaker lines`);
  }
  return lines;
}

interface ElementInput { frontal_image_url: string; reference_image_urls: string[] }

export function parseElementInputs(value: unknown): ElementInput[] {
  if (value === undefined) return [];
  if (typeof value === "string") {
    try { value = JSON.parse(value); }
    catch { throw new ValidationError("Elements must be a valid JSON array"); }
  }
  if (!Array.isArray(value) || value.length > 4) throw new ValidationError("Elements must contain at most 4 items");
  return value.map(element => {
    if (!element || typeof element !== "object" || typeof element.frontal_image_url !== "string" || (element.reference_image_urls !== undefined && (!Array.isArray(element.reference_image_urls) || element.reference_image_urls.some((url: unknown) => typeof url !== "string")))) {
      throw new ValidationError("Each element needs a frontal image and an array of reference images");
    }
    return { frontal_image_url: element.frontal_image_url, reference_image_urls: [...(element.reference_image_urls ?? [])] };
  });
}

export function composeElementInputs(inputs: Record<string, unknown>): ElementInput[] {
  const elements = parseElementInputs(inputs.elements);
  for (const [key, value] of Object.entries(inputs)) {
    const match = /^element_(0|[1-9]\d*)_(frontal|ref_(0|[1-9]\d*))$/.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    const element = elements[index];
    if (!Number.isSafeInteger(index) || !element) throw new ValidationError(`Element handle ${key} references a missing element; reconnect it`);
    if (typeof value !== "string" || !value.trim()) throw new ValidationError(`Element handle ${key} must contain an image URL`);
    if (match[2] === "frontal") element.frontal_image_url = value;
    else {
      const reference = Number(match[3]);
      if (!Number.isSafeInteger(reference) || reference >= element.reference_image_urls.length) throw new ValidationError(`Element handle ${key} references a missing reference slot; reconnect it`);
      element.reference_image_urls[reference] = value;
    }
  }
  return elements;
}
