import sourceSchema from '../../../resources/data/content.schema.json';
import { bundleLocation, pointerToken, type ValidationIssue } from './Validation.js';

interface Schema {
  $ref?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  minItems?: number;
  uniqueItems?: boolean;
  minLength?: number;
  minimum?: number;
  maximum?: number;
  oneOf?: Schema[];
  anyOf?: Schema[];
  definitions?: Record<string, Schema>;
}

const schema = sourceSchema as unknown as Schema;
interface StructuralIssue { path: string; message: string }

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const keys = Object.keys(leftObject);
  return keys.length === Object.keys(rightObject).length
    && keys.every((key) => Object.hasOwn(rightObject, key) && equalJson(leftObject[key], rightObject[key]));
}

/** Check only JSON data, without invoking accessors supplied to the unknown-input API. */
function jsonDomain(value: unknown, path: string, ancestors: WeakSet<object>, issues: StructuralIssue[]): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push({ path, message: '数值必须有限。' });
    return;
  }
  if (typeof value !== 'object') {
    issues.push({ path, message: '内容必须是 JSON 值。' });
    return;
  }
  if (ancestors.has(value)) {
    issues.push({ path, message: '内容不能包含循环对象。' });
    return;
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    issues.push({ path, message: '内容只能包含普通 JSON 对象。' });
    return;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      const itemPath = `${path}/${index}`;
      if (!descriptor || !('value' in descriptor)) issues.push({ path: itemPath, message: '数组不能包含空洞或访问器。' });
      else jsonDomain(descriptor.value, itemPath, ancestors, issues);
    }
  } else {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        issues.push({ path, message: 'JSON 对象不能包含符号键。' });
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      const itemPath = `${path}/${pointerToken(key)}`;
      if (!descriptor.enumerable || !('value' in descriptor)) issues.push({ path: itemPath, message: 'JSON 对象不能包含隐藏字段或访问器。' });
      else jsonDomain(descriptor.value, itemPath, ancestors, issues);
    }
  }
  ancestors.delete(value);
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

/** Implements every validation keyword used by our trusted schema, not arbitrary user schemas. */
function walk(value: unknown, node: Schema, path: string): StructuralIssue[] {
  if (node.$ref) {
    const prefix = '#/definitions/';
    if (!node.$ref.startsWith(prefix)) throw new Error('Trusted schema contains an external reference');
    const target = schema.definitions?.[node.$ref.slice(prefix.length)];
    if (!target) throw new Error('Trusted schema reference is missing');
    return walk(value, target, path);
  }
  const union = node.oneOf ?? node.anyOf;
  if (union) {
    const branches = union.map((branch) => walk(value, branch, path));
    const successes = branches.filter((branch) => branch.length === 0).length;
    if (node.oneOf ? successes === 1 : successes > 0) return [];
    if (successes > 1) return [{ path, message: '值同时匹配多个互斥结构。' }];
    return branches.reduce((best, branch) => branch.length < best.length ? branch : best);
  }
  const issues: StructuralIssue[] = [];
  if (node.type) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (!types.some((type) => matchesType(value, type))) return [{ path, message: `字段类型必须为 ${types.join(' / ')}。` }];
  }
  if (Object.hasOwn(node, 'const') && !equalJson(value, node.const)) issues.push({ path, message: `字段必须等于 ${JSON.stringify(node.const)}。` });
  if (node.enum && !node.enum.some((item) => equalJson(item, value))) issues.push({ path, message: '字段不属于允许的枚举值。' });
  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) issues.push({ path, message: `数值不能小于 ${node.minimum}。` });
    if (node.maximum !== undefined && value > node.maximum) issues.push({ path, message: `数值不能大于 ${node.maximum}。` });
  }
  if (typeof value === 'string' && node.minLength !== undefined && value.length < node.minLength) issues.push({ path, message: '文本不能为空。' });
  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) issues.push({ path, message: `数组至少需要 ${node.minItems} 项。` });
    if (node.uniqueItems) {
      for (let index = 0; index < value.length; index++) {
        if (value.slice(0, index).some((item) => equalJson(item, value[index]))) {
          issues.push({ path: `${path}/${index}`, message: '数组成员不能重复。' });
        }
      }
    }
    if (node.items) value.forEach((item, index) => issues.push(...walk(item, node.items!, `${path}/${index}`)));
  } else if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of node.required ?? []) {
      if (!Object.hasOwn(object, key)) issues.push({ path: `${path}/${pointerToken(key)}`, message: '缺少必填字段。' });
    }
    for (const key of Object.keys(object)) {
      const child = node.properties?.[key];
      if (child && Object.hasOwn(node.properties!, key)) issues.push(...walk(object[key], child, `${path}/${pointerToken(key)}`));
      else if (node.additionalProperties === false) issues.push({ path: `${path}/${pointerToken(key)}`, message: '不允许未知字段。' });
    }
  }
  return issues;
}

export function validateStructure(value: unknown): ValidationIssue[] {
  const issues: StructuralIssue[] = [];
  try {
    jsonDomain(value, '', new WeakSet(), issues);
    if (issues.length === 0) issues.push(...walk(value, schema, ''));
  } catch {
    issues.push({ path: '', message: '内容不是可安全读取的 JSON 对象。' });
  }
  return issues.map((issue) => ({ ...bundleLocation(issue.path), code: 'SCHEMA_INVALID', message: issue.message }));
}
