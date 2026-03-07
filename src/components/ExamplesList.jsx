import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { useConfirm } from './ConfirmModal';

export function ExamplesList({ examples, onLoadExample, onDeleteExample }) {
  const confirm = useConfirm();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getStatusClass = (status) => {
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'redirect';
    if (status >= 400 && status < 500) return 'client-error';
    if (status >= 500) return 'server-error';
    return 'error';
  };

  const handleSelect = (example) => {
    onLoadExample(example);
    setIsOpen(false);
  };

  const handleDelete = async (e, example) => {
    e.stopPropagation();
    const confirmed = await confirm({
      title: 'Delete Example',
      message: `Are you sure you want to delete "${example.name}"?`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (confirmed) {
      onDeleteExample(example.id);
    }
  };

  return (
    <div className="examples-dropdown" ref={dropdownRef}>
      <button
        className={`examples-dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        Examples ({examples?.length || 0})
        <ChevronDown size={14} />
      </button>

      {isOpen && (
        <div className="examples-dropdown-menu">
          {!examples || examples.length === 0 ? (
            <div className="examples-dropdown-empty">
              <p>No examples saved</p>
              <p className="hint">Send a request and click "Save as Example"</p>
            </div>
          ) : (
            examples.map((example) => (
              <div
                key={example.id}
                className="examples-dropdown-item"
                onClick={() => handleSelect(example)}
              >
                <span className="example-name">{example.name}</span>
                <span className={`example-status ${getStatusClass(example.response_data?.status)}`}>
                  {example.response_data?.status || '---'}
                </span>
                <button
                  className="example-delete"
                  onClick={(e) => handleDelete(e, example)}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
