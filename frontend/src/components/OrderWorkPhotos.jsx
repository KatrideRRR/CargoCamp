function OrderWorkPhotos({
                             order,
                             userId,
                             uploading = {},
                             onUpload,
                             renderPhotos,
                         }) {
    const id = Number(userId);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        Number(order.executorId) !== id
    ) {
        return null;
    }

    return (
        <section className="photo-protocol-section work-photo-section">
            <h4 className="photo-protocol-title">Мои фотографии</h4>

            <div className="work-photo-grid">
                {["Before", "After"].map((stage) => {
                    const type = `executor${stage}`;
                    const busy = Boolean(
                        uploading[`${order.id}_${type}`]
                    );

                    return (
                        <div
                            className="photo-protocol-card work-photo-card"
                            key={stage}
                        >
                            <h5>
                                {stage === "Before"
                                    ? "До работы"
                                    : "После работы"}
                            </h5>

                            {renderPhotos(order[`${type}Photos`])}

                            <label
                                className="photo-upload-button"
                                onClick={(event) => event.stopPropagation()}
                            >
                                {busy ? "Загрузка…" : "Добавить фото"}

                                <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    hidden
                                    disabled={busy}
                                    onChange={async (event) => {
                                        const input = event.currentTarget;
                                        if (!input.files?.length) return;

                                        try {
                                            await onUpload(
                                                order.id,
                                                type,
                                                input.files
                                            );
                                        } finally {
                                            input.value = "";
                                        }
                                    }}
                                />
                            </label>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
export default OrderWorkPhotos;