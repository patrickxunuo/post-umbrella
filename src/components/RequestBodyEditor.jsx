import { useRef } from 'react';
import { Upload, X } from 'lucide-react';
import { JsonEditor } from './JsonEditor';
import { TypeSelector } from './TypeSelector';
import { EnvVariableInput } from './EnvVariableInput';

function Checkbox({ checked, onChange }) {
  return <input type="checkbox" className="checkbox" checked={checked} onChange={onChange} />;
}

export function RequestBodyEditor({
  bodyType, body, formData,
  onBodyTypeChange, onBodyChange, onFormDataChange,
  activeEnvironment, collectionVariables, rootCollectionId, onEnvironmentUpdate,
}) {
  const fileInputRefs = useRef({});

  const updateFormDataField = (index, field, value) => {
    const newFormData = [...formData];
    newFormData[index] = { ...newFormData[index], [field]: value };
    onFormDataChange(newFormData);
  };

  const removeFormDataField = (index) => {
    onFormDataChange(formData.filter((_, i) => i !== index));
  };

  const handleFileSelect = async (index, file) => {
    if ('__TAURI_INTERNALS__' in window) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const { invoke } = await import('@tauri-apps/api/core');
        const selected = await open({ multiple: false });
        if (!selected) return;
        const filePath = typeof selected === 'string' ? selected : selected.path;
        const info = await invoke('read_file_at_path', { path: filePath });
        const newFormData = [...formData];
        newFormData[index] = {
          ...newFormData[index],
          value: info.base64,
          fileName: info.name,
          filePath,
          fileType: info.mime_type,
          fileSize: info.size,
        };
        onFormDataChange(newFormData);
        return;
      } catch {
        // Fall through to browser file input
      }
    }

    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      const newFormData = [...formData];
      newFormData[index] = {
        ...newFormData[index],
        value: base64,
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      };
      onFormDataChange(newFormData);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="body-editor">
      <div className="option-selector body-type-selector">
        {['none', 'form-data', 'json', 'raw'].map(type => (
          <label key={type}>
            <input
              type="radio"
              name="bodyType"
              value={type}
              checked={bodyType === type}
              onChange={() => onBodyTypeChange(type)}
            />
            {type === 'json' ? 'JSON' : type === 'raw' ? 'Raw' : type}
          </label>
        ))}
      </div>

      {bodyType === 'form-data' && (
        <div className="form-data-editor">
          <table>
            <thead>
              <tr>
                <th style={{ width: '30px' }}></th>
                <th>Key</th>
                <th style={{ width: '80px' }}>Type</th>
                <th>Value</th>
                <th style={{ width: '40px' }}></th>
              </tr>
            </thead>
            <tbody>
              {formData.map((field, index) => (
                <tr key={index}>
                  <td>
                    <Checkbox
                      checked={field.enabled !== false}
                      onChange={(e) => updateFormDataField(index, 'enabled', e.target.checked)}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      placeholder="Key"
                      value={field.key}
                      onChange={(e) => {
                        const newFormData = [...formData];
                        newFormData[index] = { ...newFormData[index], key: e.target.value };
                        if (index === formData.length - 1 && e.target.value) {
                          newFormData.push({ key: '', value: '', type: 'text', enabled: true });
                        }
                        onFormDataChange(newFormData);
                      }}
                    />
                  </td>
                  <td>
                    <TypeSelector
                      value={field.type || 'text'}
                      onChange={(newType) => {
                        updateFormDataField(index, 'type', newType);
                        if (newType === 'text') {
                          const newFormData = [...formData];
                          newFormData[index] = { ...newFormData[index], type: 'text', value: '', fileName: undefined, fileType: undefined, fileSize: undefined };
                          onFormDataChange(newFormData);
                        }
                      }}
                    />
                  </td>
                  <td>
                    {field.type === 'file' ? (
                      <div className="file-input-wrapper">
                        <input
                          type="file"
                          ref={(el) => (fileInputRefs.current[index] = el)}
                          onChange={(e) => handleFileSelect(index, e.target.files[0])}
                          style={{ display: 'none' }}
                        />
                        {field.fileName ? (
                          <div className="file-selected">
                            <span className="file-name">{field.fileName}</span>
                            {field.fileSize > 0 && (
                              <span className="file-size">({(field.fileSize / 1024).toFixed(1)} KB)</span>
                            )}
                            <button
                              type="button"
                              className="btn-icon small"
                              onClick={() => {
                                const newFormData = [...formData];
                                newFormData[index] = { ...newFormData[index], value: '', fileName: undefined, filePath: undefined, fileType: undefined, fileSize: undefined };
                                onFormDataChange(newFormData);
                              }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn-select-file"
                            onClick={() => {
                              if ('__TAURI_INTERNALS__' in window) {
                                handleFileSelect(index, null);
                              } else {
                                fileInputRefs.current[index]?.click();
                              }
                            }}
                          >
                            <Upload size={14} /> Select File
                          </button>
                        )}
                      </div>
                    ) : (
                      <EnvVariableInput
                        value={field.value || ''}
                        onChange={(e) => updateFormDataField(index, 'value', e.target.value)}
                        placeholder="Value"
                        activeEnvironment={activeEnvironment}
                        collectionVariables={collectionVariables}
                        rootCollectionId={rootCollectionId}
                        onEnvironmentUpdate={onEnvironmentUpdate}
                      />
                    )}
                  </td>
                  <td>
                    {field.key && (
                      <button className="btn-icon small danger" onClick={() => removeFormDataField(index)}>×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bodyType === 'json' && (
        <JsonEditor
          value={body}
          onChange={onBodyChange}
          placeholder='{\n  "key": "value"\n}'
          showBeautify={true}
          className="request-json-editor"
          activeEnvironment={activeEnvironment}
          collectionVariables={collectionVariables}
        />
      )}

      {bodyType === 'raw' && (
        <textarea
          className="body-textarea"
          placeholder="Enter request body"
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
        />
      )}
    </div>
  );
}
