
import React, { useEffect, useState } from "react";
import axios from "axios";

const EMPTY_PHOTOS = [];

const apiUrl = process.env.REACT_APP_API_URL;

export default function DisputeEvidenceGallery({
                                                   dispute,
                                                   token,
                                               }) {
    const photos = Array.isArray(dispute?.evidencePhotos)
        ? dispute.evidencePhotos
        : EMPTY_PHOTOS;
    const [imageUrls, setImageUrls] = useState({});

    useEffect(() => {
        if (!dispute?.id || !token || !photos.length) {
            setImageUrls({});
            return;
        }

        let cancelled = false;
        const objectUrls = [];

        const loadPhotos = async () => {
            const results = await Promise.all(
                photos.map(async (photo) => {
                    try {
                        const response = await axios.get(
                            `${apiUrl}/api/disputes/evidence/${dispute.id}/${photo.id}`,
                            {
                                headers: {
                                    Authorization: `Bearer ${token}`,
                                },
                                responseType: "blob",
                            }
                        );

                        const url = URL.createObjectURL(response.data);
                        objectUrls.push(url);

                        return [photo.id, url];
                    } catch (error) {
                        console.error(
                            "Ошибка загрузки фотографии спора:",
                            error
                        );
                        return [photo.id, null];
                    }
                })
            );

            if (!cancelled) {
                setImageUrls(Object.fromEntries(results));
            }
        };

        loadPhotos();

        return () => {
            cancelled = true;
            objectUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [dispute?.id, photos, token]);

    if (!photos.length) return null;

    return (
        <section style={{ marginTop: 16, marginBottom: 16 }}>
            <h4>Фотографии-доказательства ({photos.length})</h4>

            <div style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                marginTop: 12,
            }}>
                {photos.map((photo, index) => (
                    <div key={photo.id} style={{ width: 115 }}>
                        {imageUrls[photo.id] ? (
                            <a
                                href={imageUrls[photo.id]}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <img
                                    src={imageUrls[photo.id]}
                                    alt={`Доказательство ${index + 1}`}
                                    style={{
                                        width: 115,
                                        height: 115,
                                        objectFit: "cover",
                                        borderRadius: 10,
                                        cursor: "pointer",
                                    }}
                                />
                            </a>
                        ) : (
                            <div style={{
                                padding: 12,
                                fontSize: 12,
                                background: "#e2e8f0",
                                borderRadius: 8,
                            }}>
                                Загрузка фото…
                            </div>
                        )}

                        <small style={{
                            display: "block",
                            marginTop: 5,
                            fontSize: 11,
                        }}>
                            Пользователь #{photo.uploadedById}
                        </small>
                    </div>
                ))}
            </div>
        </section>
    );
}
