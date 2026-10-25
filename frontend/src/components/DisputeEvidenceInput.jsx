
import React, { useEffect, useMemo } from "react";

const MAX_PHOTOS = 5;
const MAX_SIZE = 8 * 1024 * 1024;

export default function DisputeEvidenceInput({
                                                 files,
                                                 onChange,
                                                 disabled = false,
                                             }) {
    const previews = useMemo(
        () => files.map((file) => ({
            file,
            url: URL.createObjectURL(file),
        })),
        [files]
    );

    useEffect(() => {
        return () => {
            previews.forEach(({ url }) => URL.revokeObjectURL(url));
        };
    }, [previews]);

    const addFiles = (event) => {
        const selected = Array.from(event.target.files || []);
        event.target.value = "";

        if (files.length + selected.length > MAX_PHOTOS) {
            alert("Максимум 5 фотографий");
            return;
        }

        if (selected.some((file) => file.size > MAX_SIZE)) {
            alert("Каждая фотография должна быть не более 8 МБ");
            return;
        }

        const validTypes = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/heic",
            "image/heif",
        ];

        if (selected.some((file) => !validTypes.includes(file.type))) {
            alert("Выберите JPG, PNG, WebP или HEIC");
            return;
        }

        onChange([...files, ...selected]);
    };

    return (
        <div style={{ margin: "16px 0" }}>
            <strong>Фотографии-доказательства</strong>

            <p style={{
                fontSize: 13,
                color: "#64748b",
                margin: "7px 0 12px",
            }}>
                Необязательно. До 5 фотографий, каждая до 8 МБ.
            </p>

            <label
                style={{
                    display: "inline-block",
                    padding: "11px 16px",
                    border: "1px solid #2563eb",
                    color: "#2563eb",
                    borderRadius: 10,
                    cursor: disabled ? "default" : "pointer",
                    fontWeight: 600,
                }}
            >
                📷 Прикрепить фото

                <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    multiple
                    hidden
                    disabled={disabled || files.length >= MAX_PHOTOS}
                    onChange={addFiles}
                />
            </label>

            {previews.length > 0 && (
                <div style={{
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                    marginTop: 14,
                }}>
                    {previews.map(({ url, file }, index) => (
                        <div key={url} style={{
                            position: "relative",
                            width: 90,
                        }}>
                            <img
                                src={url}
                                alt={`Доказательство ${index + 1}`}
                                style={{
                                    width: 90,
                                    height: 90,
                                    objectFit: "cover",
                                    borderRadius: 8,
                                    background: "#e2e8f0",
                                }}
                            />

                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onChange(
                                    files.filter((_, i) => i !== index)
                                )}
                                style={{
                                    position: "absolute",
                                    top: -7,
                                    right: -7,
                                    border: 0,
                                    borderRadius: "50%",
                                    background: "#dc2626",
                                    color: "white",
                                    width: 24,
                                    height: 24,
                                    cursor: "pointer",
                                }}
                            >
                                ×
                            </button>

                            <small style={{
                                display: "block",
                                fontSize: 10,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}>
                                {file.name}
                            </small>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
