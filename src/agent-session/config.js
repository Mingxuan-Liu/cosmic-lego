import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KernelError } from '../core/index.js';
import { copyData, freezeData, isRecord } from '../core/data.js';

export const CODEX_ADAPTER_LIMITS = Object.freeze({ maxFrameBytes: 16777216, maxPending: 64, requestTimeoutMs: 30000, maxTextChars: 12000, maxContextBytes: 65536, maxToolResultBytes: 8388608, maxEvents: 20000 });
const off = ['shell_tool', 'unified_exec', 'shell_snapshot', 'apps', 'plugins', 'hooks', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation', 'view_image', 'multi_agent', 'code_mode', 'in_app_browser', 'workspace_dependencies'];
// Explicit CLI overrides are process-local. They never alter user config/login.
export const CODEX_SAFE_CONFIG = freezeData({
  sandbox_mode: 'read-only', approval_policy: 'never', approvals_reviewer: 'user', web_search: 'disabled',
  allow_login_shell: false, project_doc_max_bytes: 0, mcp_servers: {},
  'apps._default.enabled': false, 'features.omit_skill_descriptions': true,
  // Required by this installed native build even for client dynamic tools.
  // Shell/execution tools remain disabled independently below.
  'features.code_mode_host': true,
  ...Object.fromEntries(off.map(name => [`features.${name}`, false])),
});
const fail = message => { throw new KernelError('AGENT_CONFIG', message); };
const within = (path, root) => { const difference = relative(root, path); return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference)); };
export function codexConfiguration(input = {}) {
  if (!isRecord(input) || Object.keys(input).some(key => !['executable', 'workspace', 'model', 'effort', 'permissionPolicy', 'dynamicTools', 'limits', 'protectedRoots'].includes(key))) fail('Only declared native adapter configuration fields are supported; arbitrary command-line arguments are not accepted.');
  const { executable, workspace, model, effort, permissionPolicy = 'deny', dynamicTools = [], limits: supplied = {}, protectedRoots = [] } = input;
  if (!isAbsolute(executable ?? '') || !isAbsolute(workspace ?? '')) fail('Configure an absolute agent executable and separate authoring workspace.');
  let executablePath, workspacePath;
  try { executablePath = realpathSync(executable); workspacePath = realpathSync(workspace); accessSync(executablePath, constants.X_OK); }
  catch { fail('The configured executable/workspace must already exist and the executable must be runnable.'); }
  if (!statSync(executablePath).isFile() || !statSync(workspacePath).isDirectory()) fail('Configure an executable file and workspace directory.');
  const repository = realpathSync(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
  if (!Array.isArray(protectedRoots) || protectedRoots.some(path => typeof path !== 'string' || !isAbsolute(path))) fail('Protected roots must be an array of absolute paths.');
  const roots = [repository, ...protectedRoots.map(path => realpathSync(path))];
  if (roots.some(root => within(workspacePath, root) || within(root, workspacePath))) fail('The authoring workspace must be separate from the live repository/project store.');
  if (!['deny', 'ask'].includes(permissionPolicy)) fail('Permission policy must be deny or ask.');
  if (model !== undefined && (typeof model !== 'string' || !model.trim() || model.length > 128)) fail('A configured model must be a bounded name.');
  if (effort !== undefined && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) fail('Unsupported configured reasoning effort.');
  const tools = copyData(dynamicTools);
  if (!Array.isArray(tools) || tools.length !== 1 || tools[0].name !== 'cosmic_command' || typeof tools[0].description !== 'string' || !isRecord(tools[0].inputSchema)) fail('Supply exactly the bridge-owned cosmic_command dynamic tool declaration.');
  if (Object.keys(tools[0]).some(key => !['name', 'description', 'inputSchema'].includes(key))) fail('Dynamic tools accept name, description and inputSchema only.');
  const limits = { ...CODEX_ADAPTER_LIMITS, ...copyData(supplied) };
  if (Object.keys(limits).some(key => !Object.hasOwn(CODEX_ADAPTER_LIMITS, key)) || Object.values(limits).some(number => !Number.isSafeInteger(number) || number <= 0)) fail('Adapter limits must be supported positive safe integers.');
  const config = { ...CODEX_SAFE_CONFIG, approval_policy: permissionPolicy === 'ask' ? 'on-request' : 'never' };
  const args = ['app-server', '--listen', 'stdio://', ...Object.entries(config).flatMap(([key, value]) => ['-c', `${key}=${JSON.stringify(value)}`])];
  return freezeData({ executable: executablePath, workspace: workspacePath, model: model ?? null, effort: effort ?? null, permissionPolicy,
    dynamicTools: tools.map(tool => ({ type: 'function', ...tool })), config, args, limits });
}
