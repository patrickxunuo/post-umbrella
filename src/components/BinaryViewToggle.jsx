import { Eye, FileText, Hash } from 'lucide-react';

export function BinaryViewToggle({ value, onChange, testIdPrefix }) {
  return (
    <div className="option-selector binary-view-toggle" data-testid={`${testIdPrefix}-view-toggle`}>
      <button
        className={value === 'preview' ? 'active' : ''}
        onClick={() => onChange('preview')}
        data-testid={`${testIdPrefix}-preview-btn`}
      >
        <Eye size={12} /> Preview
      </button>
      <button
        className={value === 'raw' ? 'active' : ''}
        onClick={() => onChange('raw')}
        data-testid={`${testIdPrefix}-raw-btn`}
      >
        <FileText size={12} /> Raw
      </button>
      <button
        className={value === 'hex' ? 'active' : ''}
        onClick={() => onChange('hex')}
        data-testid={`${testIdPrefix}-hex-btn`}
      >
        <Hash size={12} /> Hex
      </button>
    </div>
  );
}
