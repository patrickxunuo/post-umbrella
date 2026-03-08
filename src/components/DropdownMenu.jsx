import { useState, useRef, useEffect } from 'react';
import { MoreVertical } from 'lucide-react';

export function DropdownMenu({
  items,
  trigger,
  align = 'right',
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    // Use timeout to avoid closing immediately on the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen]);

  const handleItemClick = (e, item) => {
    e.stopPropagation();
    setIsOpen(false);
    item.onClick?.(e);
  };

  const handleTriggerClick = (e) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  return (
    <div className={`dropdown-menu-container ${className}`} ref={containerRef}>
      {trigger ? (
        <div onClick={handleTriggerClick}>
          {trigger}
        </div>
      ) : (
        <button
          className="dropdown-menu-trigger"
          onClick={handleTriggerClick}
          title="More actions"
        >
          <MoreVertical size={14} />
        </button>
      )}

      {isOpen && (
        <div className={`dropdown-menu dropdown-menu-${align}`}>
          {items.map((item, index) => {
            if (item.type === 'divider') {
              return <div key={index} className="dropdown-menu-divider" />;
            }

            return (
              <button
                key={index}
                className={`dropdown-menu-item ${item.variant === 'danger' ? 'danger' : ''}`}
                onClick={(e) => handleItemClick(e, item)}
                disabled={item.disabled}
              >
                {item.icon && <span className="dropdown-menu-icon">{item.icon}</span>}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
