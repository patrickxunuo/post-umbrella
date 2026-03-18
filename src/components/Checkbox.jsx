export function Checkbox({ checked, onChange, className, ...props }) {
  return (
    <input
      type="checkbox"
      className={`checkbox${className ? ` ${className}` : ''}`}
      checked={checked}
      onChange={onChange}
      {...props}
    />
  );
}
