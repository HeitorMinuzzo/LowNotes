<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { ArrowLeft, Bot, Check, Download, Monitor, Plus, Settings2, Sparkles, Trash2 } from 'lucide-svelte';
  import { fetchAiModels, saveAiSettings, saveCloseToTray, saveLanguage, saveTheme, saveUpdatePrefs, saveViewMode } from '$lib/api';
  import { LOCALE_LABELS, SUPPORTED_LOCALES, t, trError, type LocaleCode } from '$lib/i18n';
  import type { AiProviderConfig, AiSettings, AppSettings, AppTheme, ViewMode } from '$lib/types';
  import { version as packageVersion } from '../../../package.json';

  type Tab = 'general' | 'ai' | 'providers' | 'about';
  let { settings, initialTab = 'general', onClose, onChange } = $props<{
    settings: AppSettings;
    initialTab?: Tab;
    onClose: () => void;
    onChange: (settings: AppSettings) => void;
  }>();

  let tab = $state<Tab>(untrack(() => initialTab));
  let aiDraft = $state<AiSettings>(untrack(() => $state.snapshot(settings.ai)));
  let selectedProviderId = $state(untrack(() => settings.ai.active_provider_id || settings.ai.providers[0]?.id || ''));
  let provider = $derived(aiDraft.providers.find((item) => item.id === selectedProviderId));
  let version = $state(packageVersion);
  let error = $state('');
  let saved = $state(false);
  let busy = $state(false);
  let models = $state<string[]>([]);
  let loadingModels = $state(false);
  let showKey = $state(false);
  let addingProvider = $state(false);
  let newName = $state('');
  let newUrl = $state('');

  onMount(() => { getVersion().then((value) => version = value).catch(() => {}); });

  async function persist(action: Promise<void>, next: AppSettings) {
    error = '';
    saved = false;
    busy = true;
    try {
      await action;
      onChange(next);
      saved = true;
      setTimeout(() => saved = false, 2500);
    } catch (reason) {
      error = trError(String(reason));
    } finally {
      busy = false;
    }
  }

  function changeTheme(value: AppTheme) {
    void persist(saveTheme(value), { ...settings, theme: value });
  }
  function changeLanguage(value: LocaleCode) {
    void persist(saveLanguage(value), { ...settings, language: value });
  }
  function changeViewMode(value: ViewMode) {
    void persist(saveViewMode(value), { ...settings, view_mode: value });
  }
  function changeTray(value: boolean) {
    void persist(saveCloseToTray(value), { ...settings, close_to_tray: value });
  }
  function changeUpdates(value: boolean) {
    void persist(saveUpdatePrefs(value, settings.skipped_version), { ...settings, update_check: value });
  }
  function saveAi() {
    const nextAi = $state.snapshot(aiDraft);
    void persist(saveAiSettings(nextAi), { ...settings, ai: nextAi });
  }
  function addProvider() {
    if (!newName.trim() || !newUrl.trim()) return;
    const item: AiProviderConfig = {
      id: `custom_${crypto.randomUUID()}`,
      name: newName.trim(), base_url: newUrl.trim(), api_key: '', selected_model: '', is_custom: true,
    };
    aiDraft.providers.push(item);
    selectedProviderId = item.id;
    aiDraft.active_provider_id = item.id;
    models = [];
    newName = '';
    newUrl = '';
    addingProvider = false;
  }
  function removeProvider(id: string) {
    aiDraft.providers = aiDraft.providers.filter((item) => item.id !== id);
    selectedProviderId = aiDraft.providers[0]?.id || '';
    if (aiDraft.active_provider_id === id) aiDraft.active_provider_id = selectedProviderId;
    models = [];
  }
  async function loadModels() {
    if (!provider) return;
    error = '';
    loadingModels = true;
    try {
      models = await fetchAiModels(provider.id, provider.base_url, provider.api_key);
      if (models.length && !provider.selected_model) provider.selected_model = models[0];
    } catch (reason) {
      error = trError(String(reason));
    } finally {
      loadingModels = false;
    }
  }
</script>

<main class="settings-page">
  <header class="settings-topbar">
    <button class="settings-back" onclick={onClose} aria-label={$t('settings.back')}><ArrowLeft size={18} /> {$t('settings.back')}</button>
    <span class="settings-version">LowNotes {version}</span>
  </header>

  <div class="settings-shell">
    <div class="settings-heading">
      <div class="settings-emblem"><Settings2 size={26} strokeWidth={1.7} /></div>
      <div><h1>{$t('settings.title')}</h1><p>{$t('settings.subtitle')}</p></div>
    </div>

    <div class="settings-layout">
      <nav class="settings-nav" aria-label={$t('settings.title')}>
        <button class:active={tab === 'general'} onclick={() => tab = 'general'}><Monitor size={18} /> {$t('settings.general')}</button>
        <button class:active={tab === 'ai'} onclick={() => tab = 'ai'}><Sparkles size={18} /> {$t('settings.ai')}</button>
        <button class:active={tab === 'providers'} onclick={() => tab = 'providers'}><Bot size={18} /> {$t('settings.providers')}</button>
        <button class:active={tab === 'about'} onclick={() => tab = 'about'}><Download size={18} /> {$t('settings.about')}</button>
      </nav>

      <div class="settings-content">
        {#if tab === 'general'}
          <section class="settings-section">
            <h2>{$t('settings.appearance')}</h2><p>{$t('settings.appearanceHint')}</p>
            <div class="setting-row"><div><strong>{$t('settings.theme')}</strong><small>{$t('settings.themeHint')}</small></div>
              <div class="settings-segment"><button class:active={settings.theme === 'dark'} onclick={() => changeTheme('dark')}>{$t('settings.dark')}</button><button class:active={settings.theme === 'light'} onclick={() => changeTheme('light')}>{$t('settings.light')}</button></div></div>
            <div class="setting-row"><div><strong>{$t('settings.language')}</strong><small>{$t('settings.languageHint')}</small></div>
              <select value={settings.language || 'en-US'} onchange={(event) => changeLanguage(event.currentTarget.value as LocaleCode)}>
                {#each SUPPORTED_LOCALES as code}<option value={code}>{LOCALE_LABELS[code]}</option>{/each}
              </select></div>
            <div class="setting-row"><div><strong>{$t('settings.defaultView')}</strong><small>{$t('settings.defaultViewHint')}</small></div>
              <select value={settings.view_mode} onchange={(event) => changeViewMode(event.currentTarget.value as ViewMode)}>
                <option value="edit">{$t('editor.modeEdit')}</option><option value="split">{$t('editor.modeSplit')}</option><option value="preview">{$t('editor.modePreview')}</option>
              </select></div>
          </section>
          <section class="settings-section">
            <h2>{$t('settings.behavior')}</h2><p>{$t('settings.behaviorHint')}</p>
            <label class="setting-row setting-toggle"><div><strong>{$t('settings.closeToTray')}</strong><small>{$t('settings.closeToTrayHint')}</small></div><input type="checkbox" checked={settings.close_to_tray} onchange={(event) => changeTray(event.currentTarget.checked)} /></label>
          </section>
        {:else if tab === 'ai'}
          <section class="settings-section">
            <h2>{$t('settings.ai')}</h2><p>{$t('settings.aiHint')}</p>
            <div class="setting-row"><div><strong>{$t('settings.activeProvider')}</strong><small>{$t('settings.activeProviderHint')}</small></div>
              <select bind:value={aiDraft.active_provider_id}>{#each aiDraft.providers as item}<option value={item.id}>{item.name}</option>{/each}</select></div>
            <label class="setting-row setting-toggle"><div><strong>{$t('ai.autoLink')}</strong><small>{$t('ai.autoLinkHint')}</small></div><input type="checkbox" bind:checked={aiDraft.auto_link_notes} /></label>
            <div class="setting-field"><label for="brave-key">{$t('ai.webKey')}</label><input id="brave-key" type="password" bind:value={aiDraft.web_search_api_key} autocomplete="off" /><small>{$t('ai.webKeyHint')}</small><button class="settings-link" onclick={() => openUrl('https://api-dashboard.search.brave.com/')}>{$t('ai.webGetKey')}</button></div>
            <div class="settings-actions"><button class="settings-primary" onclick={saveAi} disabled={busy}>{$t('settings.saveAi')}</button></div>
          </section>
        {:else if tab === 'providers'}
          <section class="settings-section">
            <div class="settings-section-title"><div><h2>{$t('settings.providers')}</h2><p>{$t('settings.providersHint')}</p></div><button class="settings-primary" onclick={() => addingProvider = !addingProvider}><Plus size={16} /> {$t('settings.addProvider')}</button></div>
            {#if addingProvider}<div class="settings-add-form"><label>{$t('ai.providerNamePlaceholder')}<input bind:value={newName} /></label><label>{$t('ai.providerUrlPlaceholder')}<input bind:value={newUrl} placeholder="http://localhost:11434/v1" /></label><div class="settings-actions"><button onclick={() => addingProvider = false}>{$t('ai.cancel')}</button><button class="settings-primary" onclick={addProvider} disabled={!newName.trim() || !newUrl.trim()}>{$t('ai.add')}</button></div></div>{/if}
            <div class="provider-workspace">
              <div class="provider-list" aria-label={$t('settings.providers')}>
                {#each aiDraft.providers as item}<button class:active={selectedProviderId === item.id} onclick={() => { selectedProviderId = item.id; models = []; }}><span>{item.name}</span>{#if aiDraft.active_provider_id === item.id}<Check size={15} />{/if}</button>{/each}
              </div>
              {#if provider}<div class="provider-detail">
                <div class="provider-detail-head"><div><h3>{provider.name}</h3><small>{provider.is_custom ? $t('settings.customProvider') : $t('settings.builtInProvider')}</small></div>{#if provider.is_custom}<button class="settings-icon danger" onclick={() => removeProvider(provider.id)} title={$t('settings.removeProvider')} aria-label={$t('settings.removeProvider')}><Trash2 size={17} /></button>{/if}</div>
                <label class="setting-field">{$t('ai.baseUrl')}<input bind:value={provider.base_url} placeholder="http://localhost:11434/v1" /></label>
                <label class="setting-field">{$t('ai.apiKey')}<div class="settings-inline"><input type={showKey ? 'text' : 'password'} bind:value={provider.api_key} autocomplete="off" /><button onclick={() => showKey = !showKey}>{showKey ? $t('ai.hide') : $t('ai.show')}</button></div></label>
                <label class="setting-field">{$t('ai.selectedModel')}<input bind:value={provider.selected_model} placeholder={$t('ai.modelPlaceholder')} /></label>
                <div class="settings-models"><button onclick={loadModels} disabled={loadingModels}>{loadingModels ? $t('ai.fetching') : $t('ai.listModels')}</button>{#if models.length}<select value={provider.selected_model} onchange={(event) => provider.selected_model = event.currentTarget.value}><option value="">{$t('settings.chooseModel')}</option>{#each models as model}<option value={model}>{model}</option>{/each}</select>{/if}</div>
                <label class="settings-active-choice"><input type="radio" name="active-provider" checked={aiDraft.active_provider_id === provider.id} onchange={() => aiDraft.active_provider_id = provider.id} /> {$t('settings.useProvider')}</label>
              </div>{/if}
            </div>
            <div class="settings-actions"><button class="settings-primary" onclick={saveAi} disabled={busy}>{$t('settings.saveProviders')}</button></div>
          </section>
        {:else}
          <section class="settings-section">
            <h2>{$t('settings.about')}</h2><p>{$t('settings.aboutHint')}</p>
            <div class="settings-about"><div class="settings-about-mark">✦</div><div><strong>LowNotes</strong><span>{$t('settings.version')} {version}</span></div></div>
            <label class="setting-row setting-toggle"><div><strong>{$t('update.autoCheck')}</strong><small>{$t('settings.updateHint')}</small></div><input type="checkbox" checked={settings.update_check} onchange={(event) => changeUpdates(event.currentTarget.checked)} /></label>
            <div class="setting-row"><div><strong>{$t('settings.device')}</strong><small>{settings.device_name}</small></div></div>
          </section>
        {/if}
        {#if error}<p class="settings-error" role="alert">{error}</p>{/if}
        {#if saved}<p class="settings-saved" role="status"><Check size={15} /> {$t('settings.saved')}</p>{/if}
      </div>
    </div>
  </div>
</main>
