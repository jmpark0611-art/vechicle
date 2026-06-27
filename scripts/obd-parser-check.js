const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const root = process.cwd();
const sourcePath = path.join(root, 'lib', 'obd', 'elm327.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const obdModule = new Module(sourcePath, module);
obdModule.filename = sourcePath;
obdModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
obdModule._compile(compiled, sourcePath);

const { ELM327_INIT_COMMANDS, OBD_ODOMETER_PID, parseMode01PidResponse, parseOdometerKilometers } =
  obdModule.exports;

assert.deepEqual(ELM327_INIT_COMMANDS, ['AT Z', 'AT E0', 'AT L0', 'AT SP 0']);
assert.equal(OBD_ODOMETER_PID, '01 A6');

const odometer = parseOdometerKilometers('SEARCHING...\r41 A6 00 01 E2 40\r>');
assert.equal(odometer.ok, true);
assert.equal(odometer.value, 12345.6);

const compactOdometer = parseOdometerKilometers('41A6000003E8>');
assert.equal(compactOdometer.ok, true);
assert.equal(compactOdometer.value, 100);

const speed = parseMode01PidResponse('41 0D 3C', 0x0d);
assert.equal(speed.ok, true);
assert.deepEqual(speed.value, [0x3c]);

assert.deepEqual(parseOdometerKilometers('NO DATA'), { ok: false, reason: 'no_data' });
assert.deepEqual(parseOdometerKilometers('UNABLE TO CONNECT'), { ok: false, reason: 'unsupported' });
assert.deepEqual(parseOdometerKilometers('41 A6 01 02'), { ok: false, reason: 'invalid_response' });

console.log('obd-parser-check OK');
