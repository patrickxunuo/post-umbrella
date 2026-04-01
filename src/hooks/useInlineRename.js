import { useState, useCallback } from 'react';

export function useInlineRename() {
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  const startEditing = useCallback((id, name, e) => {
    if (e) e.stopPropagation();
    setEditingId(id);
    setEditingName(name);
  }, []);

  const finishEditing = useCallback(() => {
    setEditingId(null);
    setEditingName('');
  }, []);

  const handleRename = useCallback((onRename) => {
    if (editingName.trim() && onRename) {
      onRename(editingId, editingName);
    }
    setEditingId(null);
    setEditingName('');
  }, [editingId, editingName]);

  return {
    editingId,
    editingName,
    setEditingName,
    startEditing,
    finishEditing,
    handleRename,
  };
}
