<!-- PhaseStepper.svelte — Three-step progress indicator for pie chart animation phases -->
<svelte:options runes={true} />
<script lang="ts">

let {
  labels = ['Eliminate', 'Transfer', 'Consolidate'],
  currentStep = 0,
  disabled = false,
  onAdvance = (() => {}),
} : {
  labels: string[],
  currentStep: number,
  disabled: boolean,
  onAdvance: () => void,
} = $props();

function handleClick() {
  if (!disabled) onAdvance();
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    handleClick();
  }
}

</script>

<style>
.stepper {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
  padding: 4px 8px;
  border-radius: 4px;
}

.stepper:hover:not(.disabled) {
  background-color: #f0f0f0;
}

.stepper.disabled {
  cursor: default;
  opacity: 0.4;
}

.step {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid #ccc;
  background: white;
  transition: background-color 0.3s, border-color 0.3s;
}

.dot.active {
  background: #4747ff;
  border-color: #4747ff;
}

.dot.completed {
  background: #8888ff;
  border-color: #8888ff;
}

.label {
  font-size: 0.75rem;
  color: #888;
  transition: color 0.3s, font-weight 0.3s;
}

.label.active {
  color: #4747ff;
  font-weight: bold;
}

.label.completed {
  color: #8888ff;
}

.connector {
  width: 20px;
  height: 2px;
  background: #ccc;
  margin: 0 4px;
  transition: background-color 0.3s;
}

.connector.completed {
  background: #8888ff;
}
</style>

<div
  class="stepper"
  class:disabled
  role="button"
  tabindex={disabled ? -1 : 0}
  aria-label="Advance animation phase"
  aria-disabled={disabled}
  onclick={handleClick}
  onkeydown={handleKeyDown}
>
  {#each labels as label, i}
    {#if i > 0}
      <div class="connector" class:completed={!disabled && i <= currentStep}></div>
    {/if}
    <div class="step">
      <div class="dot"
        class:active={!disabled && i === currentStep}
        class:completed={!disabled && i < currentStep}
      ></div>
      <span class="label"
        class:active={!disabled && i === currentStep}
        class:completed={!disabled && i < currentStep}
      >{label}</span>
    </div>
  {/each}
</div>
