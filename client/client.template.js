// Snapcompact plugin-page settings card.
//
// This file is a template: scripts/build-client.ts inlines the field table from
// src/settings/metadata.ts at the marker below and writes client/client.js.
// Keeping one field table in TypeScript prevents the browser defaults and the
// Host schema from drifting apart.
window.__ModuleLoader__.load({
  id: 'dsh-snapcompact',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-snapcompact';
    const ENTRY = 'snapcompact-settings';
    const METHODS = ['snapcompact', 'handoff', 'shake', 'soft'];
    const CHAIN_PRESETS = [
      { label: 'presetVisualFirst', chain: ['snapcompact', 'handoff', 'shake', 'soft'] },
      { label: 'presetVisualNative', chain: ['snapcompact', 'soft'] },
      { label: 'presetTextFirst', chain: ['handoff', 'shake', 'soft'] },
      { label: 'presetNativeOnly', chain: ['soft'] },
    ];
    const YAML_SNIPPET = [
      '# Advanced alternative when the card is unavailable:',
      '# profile cordis.patch.yml',
      '- insert:',
      '    - id: snapcompact-settings',
      '      name: dsh-snapcompact/settings',
    ].join('\n');

    /** Field metadata generated from src/settings/metadata.ts. */
    const FIELDS = [
      /* __SNAPCOMPACT_SETTINGS_FIELDS__ */
    ];

    const ZH = {
      title: 'Snapcompact 设置',
      intro: '保存到当前 profile 的配置补丁，对新建会话生效；运行中的会话保持原配置。',
      saved: '已保存',
      unsaved: '未保存',
      saving: '保存中…',
      save: '保存',
      resetAll: '全部恢复默认',
      resetField: '恢复默认',
      restored: '已恢复默认',
      restoreError: '恢复默认失败，请重试。',
      saveError: '保存被宿主拒绝，请检查冲突后重试。',
      loading: '正在读取设置…',
      unavailableTitle: '设置尚未挂载',
      unavailableBody:
        '当前 profile 没有加载 snapcompact-settings 行，因此无法保存可视化设置。请在插件管理里重新安装/更新 dsh-snapcompact，或先用手写配置。',
      unsupportedTitle: '当前宿主不支持可视化设置',
      unsupportedBody:
        '这个 DSH 版本没有提供配置表单服务（configForms）。下面是等价的手写配置位置。',
      readOnlyTitle: '当前设置文档只读',
      readOnlyBody: '有更高优先级的配置层覆盖了当前 profile，界面只能查看，不能保存。',
      chainTitle: '方法链',
      chainHint: '按顺序尝试，第一个成功且满足压缩约束的方法会被采用；Soft 始终兜底。',
      chainEmpty: '至少保留一个方法。',
      addMethod: '添加方法',
      moveUp: '上移',
      moveDown: '下移',
      remove: '移除',
      fixedFallback: '固定兜底',
      presetVisualFirst: '视觉优先',
      presetVisualNative: '视觉 + 原生',
      presetTextFirst: '文本优先',
      presetNativeOnly: '仅原生',
      triggerTitle: '触发',
      triggerHint: '上下文占用超过阈值时触发压缩。关闭自定义即沿用宿主原生策略（默认 0.8）。',
      thresholdCustom: '自定义触发阈值',
      thresholdAuto: '自动 · 0.80',
      renderTitle: '渲染',
      frameSize: '帧尺寸',
      frameSizeHint: '方形帧的边长；越大越清晰，也越占 token。',
      maxFrames: '最多帧数',
      maxFramesHint: '单次 checkpoint 最多渲染多少帧。',
      compressionRatio: '最小压缩比',
      compressionRatioHint: '视觉路径必须把历史压缩到这个倍数以下才会采用。',
      advancedTitle: '高级',
      advancedHint: '改动较少，保持默认通常最好。',
      archiveMax: '归档上限',
      archiveMaxHint: '精确原文归档占用磁盘的上限。',
      handoffTokens: '交接预算',
      handoffTokensHint: 'Handoff 方法允许的摘要 token 上限。',
      shakeChars: '外置阈值',
      shakeCharsHint: '单个工具输出超过多少字符时由 Shake 外置归档。',
      unitMiB: 'MiB',
      unitTokens: 'tokens',
      unitChars: '字符',
      unitPx: 'px',
      'method.snapcompact': 'Snapcompact',
      'method.snapcompactHint': '把中间历史渲染成像素字帧，视觉模型直接读。',
      'method.handoff': 'Handoff',
      'method.handoffHint': '一次模型调用生成结构化交接，再继续对话。',
      'method.shake': 'Shake',
      'method.shakeHint': '把超大工具输出归档，只保留引用。',
      'method.soft': 'Soft',
      'method.softHint': '回到 DSH 原生摘要；归档与 snapcompact_recall 仍然可用。',
      effective: '当前生效',
    };

    const EN = {
      title: 'Snapcompact settings',
      intro:
        'Saved to this profile’s configuration patch and applied to new sessions; running sessions keep their configuration.',
      saved: 'Saved',
      unsaved: 'Unsaved',
      saving: 'Saving…',
      save: 'Save',
      resetAll: 'Restore all defaults',
      resetField: 'Restore default',
      restored: 'Restored',
      restoreError: 'Could not restore the default. Try again.',
      saveError: 'The host rejected the change. Check for a conflict and retry.',
      loading: 'Reading settings…',
      unavailableTitle: 'Settings are not mounted',
      unavailableBody:
        'This profile did not load the snapcompact-settings row, so visual settings cannot be saved. Reinstall or update dsh-snapcompact, or edit the configuration by hand.',
      unsupportedTitle: 'This host has no visual settings',
      unsupportedBody:
        'This DSH version does not provide the configuration-form service (configForms). The equivalent hand-written configuration is below.',
      readOnlyTitle: 'The settings document is read-only',
      readOnlyBody:
        'A higher-priority configuration layer overrides this profile, so the form is view-only.',
      chainTitle: 'Method chain',
      chainHint:
        'Tried in order; the first method that succeeds within its compression constraint wins. Soft always closes the chain.',
      chainEmpty: 'Keep at least one method.',
      addMethod: 'Add method',
      moveUp: 'Move up',
      moveDown: 'Move down',
      remove: 'Remove',
      fixedFallback: 'Fixed fallback',
      presetVisualFirst: 'Visual first',
      presetVisualNative: 'Visual + native',
      presetTextFirst: 'Text first',
      presetNativeOnly: 'Native only',
      triggerTitle: 'Trigger',
      triggerHint:
        'Compaction starts once context occupancy crosses the threshold. Turning the override off keeps the host policy default (0.8).',
      thresholdCustom: 'Custom trigger threshold',
      thresholdAuto: 'Automatic · 0.80',
      renderTitle: 'Rendering',
      frameSize: 'Frame size',
      frameSizeHint: 'Edge length of a square frame; larger is sharper and costs more tokens.',
      maxFrames: 'Maximum frames',
      maxFramesHint: 'How many frames one checkpoint may render.',
      compressionRatio: 'Minimum compression ratio',
      compressionRatioHint:
        'The visual path must shrink history by at least this factor to be used.',
      advancedTitle: 'Advanced',
      advancedHint: 'Rarely changed; the defaults are usually best.',
      archiveMax: 'Archive limit',
      archiveMaxHint: 'Disk budget for the exact-text archive.',
      handoffTokens: 'Handoff budget',
      handoffTokensHint: 'Token ceiling for the handoff summary.',
      shakeChars: 'Externalize above',
      shakeCharsHint: 'Tool output larger than this is archived by Shake.',
      unitMiB: 'MiB',
      unitTokens: 'tokens',
      unitChars: 'chars',
      unitPx: 'px',
      'method.snapcompact': 'Snapcompact',
      'method.snapcompactHint':
        'Render the middle of the history as pixel-font frames a vision model reads directly.',
      'method.handoff': 'Handoff',
      'method.handoffHint': 'Spend one model call on a structured handoff, then continue.',
      'method.shake': 'Shake',
      'method.shakeHint': 'Archive oversized tool output and keep a reference.',
      'method.soft': 'Soft',
      'method.softHint': 'Fall back to the DSH native summary; archives and recall still work.',
      effective: 'Effective',
    };

    const CSS = [
      '.sc-card{display:flex;flex-direction:column;gap:14px;padding:18px 20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}',
      '.sc-card *{box-sizing:border-box}',
      '.sc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}',
      '.sc-title{margin:0;font-size:15px;font-weight:600}',
      '.sc-intro{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.sc-chip{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 9px;font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.sc-chip-dirty{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}',
      '.sc-banner{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.sc-banner-warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,transparent);color:var(--dsw-alias-state-warn-primary)}',
      '.sc-group{display:flex;flex-direction:column;gap:8px;border-top:1px dashed var(--dsw-alias-border-l2);padding-top:12px}',
      '.sc-group-title{margin:0;font-size:13px;font-weight:600}',
      '.sc-group-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:11.5px}',
      '.sc-presets{display:flex;flex-wrap:wrap;gap:6px}',
      '.sc-preset,.sc-btn,.sc-icon-btn,.sc-add-btn{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:7px;cursor:pointer;padding:3px 9px;font-size:12px}',
      '.sc-preset-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.sc-preset:hover:enabled,.sc-btn:hover:enabled,.sc-icon-btn:hover:enabled,.sc-add-btn:hover:enabled{background:var(--dsw-alias-bg-layer-2)}',
      '.sc-preset:disabled,.sc-btn:disabled,.sc-icon-btn:disabled,.sc-add-btn:disabled{opacity:.45;cursor:default}',
      '.sc-chain{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.sc-chain-row{display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;background:var(--dsw-alias-bg-layer-1)}',
      '.sc-chain-index{flex:none;width:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:11px}',
      '.sc-chain-copy{display:flex;flex-direction:column;gap:1px;min-width:0;flex:auto}',
      '.sc-chain-name{font-weight:600;font-size:12.5px}',
      '.sc-chain-desc{color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.sc-chain-actions{display:flex;gap:4px;flex:none}',
      '.sc-tag{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:0 7px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}',
      '.sc-add{display:flex;flex-wrap:wrap;gap:6px}',
      '.sc-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.sc-switch{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px}',
      '.sc-switch input{accent-color:var(--dsw-alias-brand-primary)}',
      '.sc-slider{display:inline-flex;align-items:center;gap:8px;min-width:180px;flex:auto}',
      '.sc-slider input{flex:auto;accent-color:var(--dsw-alias-brand-primary)}',
      '.sc-value{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);min-width:44px;text-align:right}',
      '.sc-muted{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.sc-field{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}',
      '.sc-field-label{min-width:96px;color:var(--dsw-alias-label-secondary)}',
      '.sc-field input[type=number],.sc-field select{font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:2px 6px;font-size:12px}',
      '.sc-field input[type=number]{width:96px}',
      '.sc-field-hint{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.sc-field-row{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap}',
      '.sc-details summary{cursor:pointer;font-size:13px;font-weight:600;list-style:none}',
      '.sc-details summary::-webkit-details-marker{display:none}',
      '.sc-details[open] summary{margin-bottom:8px}',
      '.sc-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--dsw-alias-border-l2);padding-top:12px}',
      '.sc-foot-note{margin:0;color:var(--dsw-alias-label-secondary);font-size:11.5px;flex:auto;min-width:220px}',
      '.sc-actions{display:flex;align-items:center;gap:8px}',
      '.sc-ok{color:var(--dsw-alias-state-success-primary);font-size:12px}',
      '.sc-error{color:var(--dsw-alias-state-error-primary);font-size:12px}',
      '.sc-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.sc-code{margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11.5px;white-space:pre-wrap;overflow-wrap:anywhere}',
    ].join('');

    function fieldOf(key) {
      return FIELDS.find((field) => field.key === key);
    }

    function cloneValue(value) {
      return Array.isArray(value) ? value.slice() : value;
    }

    function sameValue(left, right) {
      if (Array.isArray(left) || Array.isArray(right)) {
        return (
          Array.isArray(left) &&
          Array.isArray(right) &&
          left.length === right.length &&
          left.every((item, index) => item === right[index])
        );
      }
      return left === right;
    }

    function defaultDraft() {
      const draft = {};
      for (const field of FIELDS) {
        if (field.defaultValue !== undefined) draft[field.key] = cloneValue(field.defaultValue);
      }
      return draft;
    }

    function draftFrom(remote) {
      const draft = defaultDraft();
      if (remote && typeof remote === 'object') {
        for (const field of FIELDS) {
          if (remote[field.key] !== undefined) draft[field.key] = cloneValue(remote[field.key]);
        }
      }
      return draft;
    }

    /** A valid chain always ends with soft and never repeats a method. */
    function sanitizeChain(input) {
      const seen = new Set();
      const chain = [];
      for (const method of Array.isArray(input) ? input : []) {
        if (!METHODS.includes(method) || method === 'soft' || seen.has(method)) continue;
        seen.add(method);
        chain.push(method);
      }
      chain.push('soft');
      return chain;
    }

    function displayValue(field, value) {
      if (typeof value !== 'number') return '';
      return field.scale ? Math.round(value / field.scale) : value;
    }

    function storedValue(field, value) {
      return field.scale ? Number(value) * field.scale : Number(value);
    }

    function Group(props) {
      return h(
        'div',
        { className: 'sc-group' },
        h('h4', { className: 'sc-group-title' }, props.title),
        props.hint ? h('p', { className: 'sc-group-hint' }, props.hint) : null,
        props.children,
      );
    }

    function NumberField(props) {
      const { field, value, label, hint, unit, disabled, onChange } = props;
      if (field === undefined) return null;
      return h(
        'div',
        { className: 'sc-field' },
        h('span', { className: 'sc-field-label' }, label),
        h('input', {
          type: 'number',
          min: field.min,
          max: field.max,
          step: field.step,
          value: displayValue(field, value),
          disabled,
          'aria-label': label,
          onChange: (event) => onChange(storedValue(field, event.target.value)),
        }),
        unit ? h('span', { className: 'sc-muted' }, unit) : null,
        hint ? h('p', { className: 'sc-field-hint' }, hint) : null,
      );
    }

    function FallbackCard(props) {
      const title = props.t(
        props.reason === 'unsupported' ? 'unsupportedTitle' : 'unavailableTitle',
      );
      const body = props.t(props.reason === 'unsupported' ? 'unsupportedBody' : 'unavailableBody');
      return h(
        'section',
        { className: 'sc-card' },
        h('style', null, CSS),
        h('h3', { className: 'sc-title' }, props.t('title')),
        h('p', { className: 'sc-intro' }, title),
        h('p', { className: 'sc-banner' }, body),
        h('pre', { className: 'sc-code' }, YAML_SNIPPET),
      );
    }

    function SettingsCard(props) {
      const { form, t } = props;
      const subscribe = React.useCallback((listener) => form.subscribe(listener), [form]);
      const readSnapshot = React.useCallback(() => form.getSnapshot(), [form]);
      const snapshot = React.useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
      const [draft, setDraft] = React.useState(() => draftFrom(snapshot.value));
      const [dirty, setDirty] = React.useState(() => new Set());
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [advancedOpen, setAdvancedOpen] = React.useState(false);

      const revision = snapshot.revision;
      React.useEffect(() => {
        setDraft((previous) => {
          if (dirty.size > 0) return previous;
          return draftFrom(snapshot.value);
        });
      }, [revision]);
      // The lint lane does not run the React hooks rules; the effect above only
      // resynchronizes when the Host revision changes.

      if (snapshot.status === 'loading') {
        return h(
          'section',
          { className: 'sc-card' },
          h('style', null, CSS),
          h('h3', { className: 'sc-title' }, t('title')),
          h('p', { className: 'sc-intro' }, t('loading')),
        );
      }
      if (snapshot.status !== 'ready') {
        return h(FallbackCard, { t, reason: 'unavailable' });
      }

      const readOnly = snapshot.writable === false;
      const chain = sanitizeChain(draft.methodOrder);
      const thresholdCustom = draft.thresholdRatio !== undefined;
      const overridden = FIELDS.filter(
        (field) => snapshot.user && snapshot.user[field.key] !== undefined,
      ).length;

      function edit(key, value) {
        setDraft((previous) => ({ ...previous, [key]: value }));
        setDirty((previous) => {
          const next = new Set(previous);
          next.add(key);
          return next;
        });
        setNotice(null);
        setError(null);
      }

      function setChain(next) {
        edit('methodOrder', sanitizeChain(next));
      }

      function moveMethod(index, delta) {
        const next = chain.slice();
        const target = index + delta;
        if (target < 0 || target >= next.length) return;
        if (next[target] === 'soft' || next[index] === 'soft') return;
        const current = next[index];
        next[index] = next[target];
        next[target] = current;
        setChain(next);
      }

      function removeMethod(index) {
        if (chain[index] === 'soft') return;
        setChain(chain.filter((_, position) => position !== index));
      }

      function addMethod(method) {
        const next = chain.slice();
        next.splice(next.length - 1, 0, method);
        setChain(next);
      }

      async function save() {
        if (dirty.size === 0 || busy) return;
        setBusy(true);
        setError(null);
        setNotice(null);
        let failed = false;
        for (const key of dirty) {
          const field = fieldOf(key);
          if (field === undefined) continue;
          const value = draft[key];
          const reset =
            value === undefined ||
            (field.defaultValue !== undefined && sameValue(value, field.defaultValue));
          let accepted = false;
          try {
            accepted = reset
              ? await form.unset(key)
              : await form.set(key, Array.isArray(value) ? value.slice() : value);
          } catch {
            accepted = false;
          }
          if (!accepted) {
            failed = true;
            break;
          }
        }
        setBusy(false);
        if (failed) setError(t('saveError'));
        else {
          setDirty(new Set());
          setNotice(t('saved'));
        }
      }

      async function resetField(key) {
        const field = fieldOf(key);
        if (field === undefined || busy) return;
        setBusy(true);
        setError(null);
        let accepted = false;
        try {
          accepted = await form.unset(key);
        } catch {
          accepted = false;
        }
        setBusy(false);
        if (!accepted) {
          setError(t('restoreError'));
          return;
        }
        setDraft((previous) => ({
          ...previous,
          [key]: field.defaultValue === undefined ? undefined : cloneValue(field.defaultValue),
        }));
        setDirty((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
        setNotice(t('restored'));
      }

      async function resetAll() {
        if (busy) return;
        const keys = FIELDS.filter(
          (field) => snapshot.user && snapshot.user[field.key] !== undefined,
        ).map((field) => field.key);
        if (keys.length === 0) return;
        setBusy(true);
        setError(null);
        let failed = false;
        for (const key of keys) {
          let accepted = false;
          try {
            accepted = await form.unset(key);
          } catch {
            accepted = false;
          }
          if (!accepted) {
            failed = true;
            break;
          }
        }
        setBusy(false);
        if (failed) {
          setError(t('restoreError'));
          return;
        }
        setDirty(new Set());
        setDraft(defaultDraft());
        setNotice(t('restored'));
      }

      const methodRow = (method, index) =>
        h(
          'li',
          { key: method, className: 'sc-chain-row' },
          h('span', { className: 'sc-chain-index' }, String(index + 1)),
          h(
            'div',
            { className: 'sc-chain-copy' },
            h('span', { className: 'sc-chain-name' }, t(`method.${method}`)),
            h('span', { className: 'sc-chain-desc' }, t(`method.${method}Hint`)),
          ),
          method === 'soft'
            ? h('span', { className: 'sc-tag' }, t('fixedFallback'))
            : h(
                'div',
                { className: 'sc-chain-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sc-icon-btn',
                    title: t('moveUp'),
                    'aria-label': t('moveUp'),
                    disabled: readOnly || busy || index === 0,
                    onClick: () => moveMethod(index, -1),
                  },
                  '\u2191',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sc-icon-btn',
                    title: t('moveDown'),
                    'aria-label': t('moveDown'),
                    disabled: readOnly || busy || chain[index + 1] === 'soft',
                    onClick: () => moveMethod(index, 1),
                  },
                  '\u2193',
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sc-icon-btn',
                    title: t('remove'),
                    'aria-label': t('remove'),
                    disabled: readOnly || busy || chain.length === 1,
                    onClick: () => removeMethod(index),
                  },
                  '\u2715',
                ),
              ),
        );

      const missing = METHODS.filter((method) => method !== 'soft' && !chain.includes(method));

      /** Per-field restore, shown only while the namespace holds an explicit override. */
      const resetButton = (key) => {
        const isOverridden = Boolean(snapshot.user && snapshot.user[key] !== undefined);
        if (!isOverridden) return null;
        return h(
          'button',
          {
            type: 'button',
            className: 'sc-icon-btn',
            title: t('resetField'),
            disabled: readOnly || busy,
            onClick: () => {
              void resetField(key);
            },
          },
          t('resetField'),
        );
      };

      return h(
        'section',
        { className: 'sc-card' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'sc-head' },
          h(
            'div',
            null,
            h('h3', { className: 'sc-title' }, t('title')),
            h('p', { className: 'sc-intro' }, t('intro')),
          ),
          h(
            'span',
            { className: dirty.size > 0 ? 'sc-chip sc-chip-dirty' : 'sc-chip' },
            dirty.size > 0 ? t('unsaved') : t('saved'),
          ),
        ),
        readOnly
          ? h(
              'div',
              { className: 'sc-banner sc-banner-warn' },
              `${t('readOnlyTitle')} ${t('readOnlyBody')}`,
            )
          : null,
        h(Group, {
          title: t('chainTitle'),
          hint: t('chainHint'),
          children: [
            h(
              'div',
              { className: 'sc-presets', key: 'presets' },
              CHAIN_PRESETS.map((preset) =>
                h(
                  'button',
                  {
                    key: preset.label,
                    type: 'button',
                    className: sameValue(chain, preset.chain)
                      ? 'sc-preset sc-preset-on'
                      : 'sc-preset',
                    disabled: readOnly || busy,
                    onClick: () => setChain(preset.chain),
                  },
                  t(preset.label),
                ),
              ),
            ),
            h('ol', { className: 'sc-chain', key: 'chain' }, chain.map(methodRow)),
            missing.length > 0
              ? h(
                  'div',
                  { className: 'sc-add', key: 'add' },
                  missing.map((method) =>
                    h(
                      'button',
                      {
                        key: method,
                        type: 'button',
                        className: 'sc-add-btn',
                        disabled: readOnly || busy,
                        onClick: () => addMethod(method),
                      },
                      `+ ${t(`method.${method}`)}`,
                    ),
                  ),
                )
              : null,
          ],
        }),
        h(Group, {
          title: t('triggerTitle'),
          hint: t('triggerHint'),
          children: [
            h(
              'div',
              { className: 'sc-row', key: 'threshold' },
              h(
                'label',
                { className: 'sc-switch' },
                h('input', {
                  type: 'checkbox',
                  checked: thresholdCustom,
                  disabled: readOnly || busy,
                  onChange: (event) =>
                    edit('thresholdRatio', event.target.checked ? 0.8 : undefined),
                }),
                h('span', null, t('thresholdCustom')),
              ),
              thresholdCustom
                ? h(
                    'div',
                    { className: 'sc-slider' },
                    h('input', {
                      type: 'range',
                      min: 0.5,
                      max: 0.95,
                      step: 0.01,
                      value: draft.thresholdRatio,
                      disabled: readOnly || busy,
                      'aria-label': t('thresholdCustom'),
                      onChange: (event) => edit('thresholdRatio', Number(event.target.value)),
                    }),
                    h('span', { className: 'sc-value' }, Number(draft.thresholdRatio).toFixed(2)),
                  )
                : h('span', { className: 'sc-muted' }, t('thresholdAuto')),
              resetButton('thresholdRatio'),
            ),
          ],
        }),
        h(Group, {
          title: t('renderTitle'),
          children: [
            h(
              'div',
              { className: 'sc-field', key: 'frame' },
              h('span', { className: 'sc-field-label' }, t('frameSize')),
              h(
                'select',
                {
                  value: displayValue(fieldOf('frameSize'), draft.frameSize),
                  disabled: readOnly || busy,
                  'aria-label': t('frameSize'),
                  onChange: (event) => edit('frameSize', Number(event.target.value)),
                },
                [1024, 1568, 2048].map((size) =>
                  h('option', { key: size, value: size }, `${size} ${t('unitPx')}`),
                ),
              ),
              resetButton('frameSize'),
              h('p', { className: 'sc-field-hint' }, t('frameSizeHint')),
            ),
            h(
              'div',
              { className: 'sc-field', key: 'frames' },
              h('span', { className: 'sc-field-label' }, t('maxFrames')),
              h(
                'div',
                { className: 'sc-slider' },
                h('input', {
                  type: 'range',
                  min: 1,
                  max: 20,
                  step: 1,
                  value: draft.maxFrames,
                  disabled: readOnly || busy,
                  'aria-label': t('maxFrames'),
                  onChange: (event) => edit('maxFrames', Number(event.target.value)),
                }),
                h('span', { className: 'sc-value' }, String(draft.maxFrames)),
              ),
              resetButton('maxFrames'),
              h('p', { className: 'sc-field-hint' }, t('maxFramesHint')),
            ),
            h(
              'div',
              { key: 'ratio', className: 'sc-field-row' },
              h(NumberField, {
                field: fieldOf('minCompressionRatio'),
                value: draft.minCompressionRatio,
                label: t('compressionRatio'),
                hint: t('compressionRatioHint'),
                disabled: readOnly || busy,
                onChange: (value) => edit('minCompressionRatio', value),
              }),
              resetButton('minCompressionRatio'),
            ),
          ],
        }),
        h(
          'details',
          {
            className: 'sc-group sc-details',
            open: advancedOpen,
            onToggle: (event) => setAdvancedOpen(event.target.open),
          },
          h('summary', null, t('advancedTitle')),
          h('p', { className: 'sc-group-hint' }, t('advancedHint')),
          h(
            'div',
            { className: 'sc-field-row' },
            h(NumberField, {
              field: fieldOf('archiveMaxBytes'),
              value: draft.archiveMaxBytes,
              label: t('archiveMax'),
              hint: t('archiveMaxHint'),
              unit: t('unitMiB'),
              disabled: readOnly || busy,
              onChange: (value) => edit('archiveMaxBytes', value),
            }),
            resetButton('archiveMaxBytes'),
          ),
          h(
            'div',
            { className: 'sc-field-row' },
            h(NumberField, {
              field: fieldOf('handoffMaxTokens'),
              value: draft.handoffMaxTokens,
              label: t('handoffTokens'),
              hint: t('handoffTokensHint'),
              unit: t('unitTokens'),
              disabled: readOnly || busy,
              onChange: (value) => edit('handoffMaxTokens', value),
            }),
            resetButton('handoffMaxTokens'),
          ),
          h(
            'div',
            { className: 'sc-field-row' },
            h(NumberField, {
              field: fieldOf('shakeThresholdChars'),
              value: draft.shakeThresholdChars,
              label: t('shakeChars'),
              hint: t('shakeCharsHint'),
              unit: t('unitChars'),
              disabled: readOnly || busy,
              onChange: (value) => edit('shakeThresholdChars', value),
            }),
            resetButton('shakeThresholdChars'),
          ),
        ),
        h(
          'div',
          { className: 'sc-footer' },
          h('p', { className: 'sc-foot-note' }, `${t('effective')}: ${chain.join(' \u2192 ')}`),
          h(
            'div',
            { className: 'sc-actions' },
            notice ? h('span', { className: 'sc-ok' }, notice) : null,
            error ? h('span', { className: 'sc-error' }, error) : null,
            h(
              'button',
              {
                type: 'button',
                className: 'sc-btn',
                disabled: readOnly || busy || overridden === 0,
                onClick: () => {
                  void resetAll();
                },
              },
              t('resetAll'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'sc-btn sc-btn-primary',
                disabled: readOnly || busy || dirty.size === 0,
                onClick: () => {
                  void save();
                },
              },
              busy ? t('saving') : t('save'),
            ),
          ),
        ),
      );
    }

    function Card(props) {
      if (props.form === null || props.form === undefined) {
        return h(FallbackCard, { t: props.t, reason: 'unsupported' });
      }
      return h(SettingsCard, props);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale');
        if (locale !== undefined) {
          ctx.effect(
            () => locale.register(NS, { zh: ZH, en: EN }),
            'dsh-snapcompact: dictionaries',
          );
        }
        const t = (key) => {
          try {
            if (locale !== undefined) return locale.bind(NS)(key);
          } catch {
            // Fall through to the built-in dictionaries.
          }
          return ZH[key] ?? EN[key] ?? key;
        };
        const slots = ctx.get('slots');
        if (slots === undefined) {
          ctx.logger?.warn?.(
            '[dsh-snapcompact] slots service is unavailable; settings card not mounted',
          );
          return;
        }
        const forms = ctx.get('configForms');
        const form =
          forms !== undefined && typeof forms.get === 'function' ? forms.get(ENTRY) : null;
        slots.inject('plugins.bundle.config', () =>
          slots.register(
            {
              name: 'plugins.bundle.config',
              key: 'dsh-snapcompact',
              locale: NS,
              inject: () => ({ form, t }),
            },
            Card,
          ),
        );
      },
    };
  },
});
