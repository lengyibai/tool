<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { LuChevronDown } from "vue-icons-plus/lu";

export interface SelectFieldOption {
  /** 选项值 */
  value: string;
  /** 选项文案 */
  label: string;
}

interface Props {
  /** 下拉选项 */
  options: SelectFieldOption[];
  /** 是否禁用 */
  disabled?: boolean;
  /** 无障碍名称 */
  ariaLabel: string;
}
const $props = withDefaults(defineProps<Props>(), {
  disabled: false,
});
const modelValue = defineModel<string>({ required: true });

let nextSelectFieldId = 0;
const selectFieldRef = ref<HTMLElement>();
const isOpen = ref(false);
const highlightedIndex = ref(0);
const listboxId = `select-field-${++nextSelectFieldId}`;
const selectedOption = computed(() => $props.options.find((option) => option.value === modelValue.value));
const selectedIndex = computed(() => $props.options.findIndex((option) => option.value === modelValue.value));

const syncHighlightedIndex = () => {
  highlightedIndex.value = selectedIndex.value >= 0 ? selectedIndex.value : 0;
};

const openDropdown = () => {
  if ($props.disabled || !$props.options.length) return;
  syncHighlightedIndex();
  isOpen.value = true;
};

const closeDropdown = () => {
  isOpen.value = false;
};

const selectOption = (index: number) => {
  const option = $props.options[index];
  if (!option) return;

  modelValue.value = option.value;
  highlightedIndex.value = index;
  window.setTimeout(closeDropdown);
};

const moveHighlight = (offset: number) => {
  const optionCount = $props.options.length;
  if (!optionCount) return;

  highlightedIndex.value = (highlightedIndex.value + offset + optionCount) % optionCount;
};

const handleKeydown = (event: KeyboardEvent) => {
  if ($props.disabled) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (!isOpen.value) openDropdown();
    else moveHighlight(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (!isOpen.value) openDropdown();
    else moveHighlight(-1);
    return;
  }
  if (event.key === "Home" && isOpen.value) {
    event.preventDefault();
    highlightedIndex.value = 0;
    return;
  }
  if (event.key === "End" && isOpen.value) {
    event.preventDefault();
    highlightedIndex.value = $props.options.length - 1;
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && isOpen.value) {
    event.preventDefault();
    selectOption(highlightedIndex.value);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeDropdown();
  }
};

const handleDocumentMouseDown = (event: MouseEvent) => {
  if (selectFieldRef.value && event.target instanceof Node && !selectFieldRef.value.contains(event.target)) {
    closeDropdown();
  }
};

onMounted(() => document.addEventListener("mousedown", handleDocumentMouseDown));
onBeforeUnmount(() => document.removeEventListener("mousedown", handleDocumentMouseDown));
</script>

<template>
  <span ref="selectFieldRef" class="select-field" :class="{ 'is-open': isOpen, 'is-disabled': $props.disabled }">
    <button
      class="select-trigger"
      type="button"
      role="combobox"
      :aria-label="$props.ariaLabel"
      :aria-controls="listboxId"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      :aria-activedescendant="isOpen ? `${listboxId}-option-${highlightedIndex}` : undefined"
      :disabled="$props.disabled"
      @click="isOpen ? closeDropdown() : openDropdown()"
      @keydown="handleKeydown"
    >
      <span>{{ selectedOption?.label ?? "请选择" }}</span>
      <LuChevronDown :size="17" aria-hidden="true" />
    </button>
    <div v-if="isOpen" :id="listboxId" class="select-options" role="listbox" :aria-label="$props.ariaLabel">
      <div
        v-for="(option, index) in $props.options"
        :id="`${listboxId}-option-${index}`"
        :key="option.value"
        class="select-option"
        :class="{ 'is-highlighted': highlightedIndex === index, 'is-selected': modelValue === option.value }"
        role="option"
        :aria-selected="modelValue === option.value"
        @click.stop="selectOption(index)"
      >
        <span>{{ option.label }}</span>
        <span v-if="modelValue === option.value" class="selected-mark" aria-hidden="true">✓</span>
      </div>
    </div>
  </span>
</template>
<style scoped lang="less">
.select-field {
  position: relative;
  display: flex;
  align-items: center;

  > .select-trigger {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    height: 40px;
    padding: 0 var(--gap-3);
    border: 1px solid @border-strong;
    border-radius: var(--radius-2);
    color: @text;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    background: @bg;
    transition:
      border-color 160ms ease,
      box-shadow 160ms ease,
      background-color 160ms ease;

    &:hover:not(:disabled) {
      border-color: @accent;
      background: fade(@accent, 4%);
    }

    &:focus-visible {
      border-color: @accent;
      outline: 2px solid fade(@accent, 22%);
      outline-offset: 1px;
      box-shadow: 0 0 0 3px fade(@accent, 8%);
    }

    &:disabled {
      cursor: wait;
      opacity: 0.6;
    }

    > svg {
      flex: 0 0 auto;
      color: @text-dim;
      transition: color 160ms ease, transform 160ms ease;
    }
  }

  &.is-open > .select-trigger {
    border-color: @accent;
    box-shadow: 0 0 0 3px fade(@accent, 8%);

    > svg {
      color: @accent;
      transform: rotate(180deg);
    }
  }

  > .select-options {
    position: absolute;
    top: calc(100% + var(--gap-2));
    right: 0;
    left: 0;
    z-index: 10;
    overflow: auto;
    max-height: 216px;
    padding: var(--gap-1);
    border: 1px solid @border-strong;
    border-radius: var(--radius-2);
    box-shadow: 0 12px 28px fade(#000, 32%);
    background: @surface;
  }

  .select-option {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 38px;
    padding: 0 var(--gap-3);
    border-radius: var(--radius);
    color: @text-muted;
    font-size: 14px;
    cursor: pointer;
    transition: color 160ms ease, background-color 160ms ease;

    &.is-highlighted,
    &:hover {
      color: @text;
      background: @accent-soft;
    }

    &.is-selected {
      color: @accent;
      font-weight: bold;
    }

    &.is-selected.is-highlighted,
    &.is-selected:hover {
      color: @accent-hover;
    }
  }

  .selected-mark {
    color: @accent;
    font-size: 16px;
  }
}
</style>
