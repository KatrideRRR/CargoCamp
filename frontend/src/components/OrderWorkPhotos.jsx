import React from "react";

export default function OrderWorkPhotos({
                                            order,
                                            userId,
                                            uploading = {},
                                            onUpload,
                                            renderPhotos,
                                        }) {
    const currentUserId = Number(userId);

    if (
        !Number.isSafeInteger(currentUserId) ||
        currentUserId <= 0 ||
        Number(order?.executorId) !== currentUserId
    ) {
        return null;
    }

    const beforePhotos = Array.isArray(order.images)
        ? order.images
        : [];

    const afterPhotos = Array.isArray(
        order.executorAfterPhotos
    )
        ? order.executorAfterPhotos
        : [];

    const uploadType = "executorAfter";

    const busy = Boolean(
        uploading[`${order.id}_${uploadType}`]
    );

    return (
        <section className="photo-protocol-section work-photo-section">
            <h4 className="photo-protocol-title">
                Мои фотографии
            </h4>

            <div className="work-photo-grid">
                <div className="photo-protocol-card work-photo-card">
                    <h5>До работы</h5>

                    {beforePhotos.length > 0 ? (
                        <p className="photo-empty">
                            Заказчик прикрепил фотографии
                            при создании заказа:{" "}
                            <strong>{beforePhotos.length} шт.</strong>
                            {" "}Посмотреть их можно
                            в карточке заказа выше.
                        </p>
                    ) : (
                        <p className="photo-empty">
                            При создании заказа фотографии
                            не прикреплялись.
                        </p>
                    )}

                    <p className="photo-empty">
                        Дополнительная загрузка
                        фотографий до работы
                        не предусмотрена.
                    </p>
                </div>

                <div className="photo-protocol-card work-photo-card">
                    <h5>После работы</h5>

                    {renderPhotos(afterPhotos)}

                    <label
                        className="photo-upload-button"
                        onClick={(event) =>
                            event.stopPropagation()
                        }
                    >
                        {busy
                            ? "Загрузка…"
                            : "Добавить фото"}

                        <input
                            type="file"
                            accept="image/*"
                            multiple
                            hidden
                            disabled={busy}
                            aria-label="Загрузить фото после работы"
                            onChange={async (event) => {
                                const input =
                                    event.currentTarget;

                                if (!input.files?.length) {
                                    return;
                                }

                                try {
                                    await onUpload(
                                        order.id,
                                        uploadType,
                                        input.files
                                    );
                                } finally {
                                    input.value = "";
                                }
                            }}
                        />
                    </label>
                </div>
            </div>
        </section>
    );
}