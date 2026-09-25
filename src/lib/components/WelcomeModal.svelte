<script lang="ts">
  import { markWelcomeSeen } from '../api';

  let {
    isOpen = $bindable(false),
    onOpenAiChat,
  } = $props<{
    isOpen: boolean;
    onOpenAiChat?: () => void;
  }>();

  async function handleDismiss(openAi: boolean = false) {
    isOpen = false;
    try {
      await markWelcomeSeen();
    } catch (e) {
      console.error('Erro ao marcar apresentação como vista:', e);
    }
    if (openAi && onOpenAiChat) {
      onOpenAiChat();
    }
  }
</script>

{#if isOpen}
  <div
    class="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none animate-fadeIn"
    role="presentation"
  >
    <div
      class="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- Hero Header -->
      <div class="px-8 pt-8 pb-6 text-center border-b border-[var(--border)] bg-gradient-to-b from-[var(--bg-hover)] to-[var(--bg-card)]">
        <div class="w-14 h-14 rounded-2xl bg-[var(--bg-main)] border border-[var(--accent)]/40 flex items-center justify-center text-2xl mx-auto mb-4 shadow-lg text-[var(--accent-light)]">
          ✦
        </div>
        <h2 class="text-xl font-bold text-[var(--text-main)] mb-1.5">Conheça o LowNotes</h2>
        <p class="text-xs text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
          Seu novo editor de notas Markdown local-first: rápido, sem servidores centrais e com IA conectada ao seu vault.
        </p>
      </div>

      <!-- Feature Pillars -->
      <div class="p-8 flex flex-col gap-4">
        <!-- Feature 1 -->
        <div class="flex items-start gap-3.5 p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border)]">
          <span class="text-xl mt-0.5">📄</span>
          <div>
            <h4 class="text-xs font-bold text-[var(--text-main)] mb-0.5">100% Markdown com Mermaid</h4>
            <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Suas notas continuam como arquivos <code class="text-[var(--accent-light)]">.md</code> no seu disco. Suporta edição rica com CodeMirror 6 e renderização instantânea de diagramas e gráficos Mermaid.
            </p>
          </div>
        </div>

        <!-- Feature 2 -->
        <div class="flex items-start gap-3.5 p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--border)]">
          <span class="text-xl mt-0.5">🔗</span>
          <div>
            <h4 class="text-xs font-bold text-[var(--text-main)] mb-0.5">Sincronização P2P sem Servidor</h4>
            <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Conecte seus computadores diretamente via Iroh QUIC criptografado com chaves ed25519. Permite até edição colaborativa na mesma nota em tempo real usando CRDT (Yrs/Yjs).
            </p>
          </div>
        </div>

        <!-- Feature 3 -->
        <div class="flex items-start gap-3.5 p-3 rounded-xl bg-[var(--bg-main)] border border-[var(--accent)]/30">
          <span class="text-xl mt-0.5">🤖</span>
          <div>
            <h4 class="text-xs font-bold text-[var(--text-main)] mb-0.5 flex items-center gap-1.5">
              <span>Assistente de IA & RAG Local</span>
              <span class="px-1.5 py-0.2 text-[9px] font-mono rounded bg-[var(--accent)] text-black font-bold">NOVO</span>
            </h4>
            <p class="text-[11px] text-[var(--text-muted)] leading-relaxed">
              Clique no botão de chat <span class="text-[var(--accent-light)] font-bold">💬</span> na barra superior direita para fazer perguntas ao seu vault. A IA busca trechos e cita links clicáveis que levam você direto à linha da nota!
            </p>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="px-8 pb-8 pt-2 flex items-center justify-between border-t border-[var(--border)] bg-[var(--bg-sidebar)]">
        <button
          onclick={() => handleDismiss(false)}
          class="text-xs text-[var(--text-dim)] hover:text-[var(--text-main)] transition"
        >
          Pular Apresentação
        </button>

        <div class="flex gap-2">
          <button
            onclick={() => handleDismiss(false)}
            class="px-5 py-2.5 bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border)] text-xs font-semibold rounded-xl text-[var(--text-main)] transition"
          >
            Começar a Escrever
          </button>
          <button
            onclick={() => handleDismiss(true)}
            class="px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-light)] text-black text-xs font-semibold rounded-xl shadow-lg transition flex items-center gap-1.5"
          >
            <span>Testar Assistente IA</span>
            <span>💬</span>
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes fadeIn {
    from { opacity: 0; transform: scale(0.97); }
    to { opacity: 1; transform: scale(1); }
  }
  .animate-fadeIn {
    animation: fadeIn 0.15s ease-out;
  }
</style>
