import React, { useRef, useEffect } from "react";

const BigRoad = ({ results }) => {
    const ROWS = 8;
    const grid = [];

    let col = 0;
    let row = 0;
    let last = null;

    let isHorizontal = false;
    let lastRunStartCol = 0;

    const ensureColumn = (index) => {
        if (!grid[index]) grid[index] = Array(ROWS).fill(null);
    };

    results.forEach((r) => {
        if (r === "Tie") {
            ensureColumn(col);
            if (grid[col][row]) {
                grid[col][row].tieCount = (grid[col][row].tieCount || 0) + 1;
            }
            return;
        }

        const isNewRun = r !== last;

        if (isNewRun) {
            col = last === null ? 0 : lastRunStartCol + 1;
            row = 0;
            ensureColumn(col);
            lastRunStartCol = col;
            isHorizontal = false;
        } else {
            const nextRow = row + 1;

            if (!isHorizontal) {
                if (nextRow < ROWS && grid[col][nextRow] === null) {
                    row = nextRow;
                } else {
                    isHorizontal = true;
                    col++;
                    ensureColumn(col);
                }
            } else {
                col++;
                ensureColumn(col);
            }
        }

        last = r;

        grid[col][row] = {
            type: r,
            tieCount: grid[col][row]?.tieCount ?? 0,
        };
    });

    const scrollRef = useRef(null);

    useEffect(() => {
        const el = scrollRef.current;
        if (el) {
            requestAnimationFrame(() => {
                el.scrollLeft = el.scrollWidth;
            });
        }
    }, [results]);

    return (
        <div
            ref={scrollRef}
            style={{
                display: "flex",
                flexDirection: "row",
                border: "1px solid #999",
                background: "#ffffff22",
                padding: 4,
                overflowX: "auto",
                whiteSpace: "nowrap",
            }}
        >
            {grid.map((column, colIndex) => (
                <div key={colIndex} style={{ display: "flex", flexDirection: "column" }}>
                    {column.map((cell, rowIndex) => (
                        <div
                            key={rowIndex}
                            style={{
                                width: 22,
                                height: 22,
                                margin: 1,
                                border: "1px solid #ccc",
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: cell
                                    ? cell.type === "Banker"
                                        ? "#d33"
                                        : "#3a6ee8"
                                    : "transparent",
                                color: "#fff",
                                fontWeight: "bold",
                                fontSize: 14,
                                position: "relative",
                            }}
                        >
                            {cell && (cell.type === "Banker" ? "B" : "P")}
                            {cell && cell.tieCount > 0 && (
                                <div
                                    style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: "50%",
                                        backgroundColor: "lime",
                                        position: "absolute",
                                        bottom: 2,
                                        right: 2,
                                    }}
                                />
                            )}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
};

export default BigRoad;
