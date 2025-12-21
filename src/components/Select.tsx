"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { forwardRef } from "react";
import { CheckIcon, ChevronDownIcon } from "./Icons";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const SelectItem = forwardRef<HTMLDivElement, RadixSelect.SelectItemProps>(
  ({ children, ...props }, ref) => (
    <RadixSelect.Item className="select-item" {...props} ref={ref}>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="select-item-indicator">
        <CheckIcon />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  )
);
SelectItem.displayName = "SelectItem";

export default function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled = false,
  className = "",
}: SelectProps) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger className={`select-trigger ${className}`} disabled={disabled}>
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="select-icon">
          <ChevronDownIcon />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="select-content" position="popper" sideOffset={4}>
          <RadixSelect.Viewport className="select-viewport">
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
