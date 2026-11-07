import { expect, it } from 'vitest';
import { loadContent } from '../../tools/lib/ContentLoader.js';
import { getNativeMingEndContent } from '../../assets/scripts/application/NativeContentLoader.js';
import { GameEngine } from '../../assets/scripts/core/engine/GameEngine.js';
import { startWithCard } from './card-selection.js';

it('continues a CLI-created selected-card save with the native UI loader', async () => {
  const cliContent = await loadContent('assets/resources/data/ming_end');
  const nativeContent = getNativeMingEndContent();
  expect(nativeContent.fingerprint).toBe(cliContent.fingerprint);
  const cli = new GameEngine(cliContent.bundle, cliContent.fingerprint);
  startWithCard(cli, { seed: 42 });
  const native = new GameEngine(nativeContent.bundle, nativeContent.fingerprint);
  native.restoreSave(JSON.parse(JSON.stringify(cli.exportSave())));
  expect(native.current()).toEqual(cli.current());
  for (let step = 0; step < 12; step++) {
    const current = cli.current();
    const command = `cross-loader:${step}`;
    if (current.state.status === 'ENDED') break;
    const pending = current.pending;
    if (pending?.kind === 'option') {
      const option = pending.options.find(item => item.available);
      if (!option) throw new Error('No available opening/continuation option');
      expect(native.resolveOption(command, pending.event_instance_id, option.id)).toEqual(cli.resolveOption(command, pending.event_instance_id, option.id));
    } else if (pending?.kind === 'stage') {
      expect(native.resolveStage(command, pending.event_instance_id, pending.stage_id)).toEqual(cli.resolveStage(command, pending.event_instance_id, pending.stage_id));
    } else {
      expect(native.nextYear(command)).toEqual(cli.nextYear(command));
    }
  }
  expect(native.exportSave()).toEqual(cli.exportSave());
});
