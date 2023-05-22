import { useState } from "react";
import { RichTextarea } from "rich-textarea";

const splitOn = (slicable, ...indices) =>
    [0, ...indices].map((n, i, m) => slicable.slice(n, m[i + 1]));

export const CborInput = ({position, onChange}) => {
    const [text, setText] = useState("");
    let start = position[0] * 2;
    let end = position[1] * 2 + start;

    return (
        <RichTextarea
            style={{ width: "100%", height: "100%", border: "none", resize: "none", outline: "none"}}
            value={text}
            onChange={(e) => {
                setText(e.target.value);
                onChange(e.target.value);
            }}
        >
            {(v) => {
                if (start === end) {
                    return v;
                }
                const nodes: React.ReactElement[] = [];
                const parts = splitOn(v, start, end);
                nodes.push(<span key={0}>{parts[0]}</span>)
                nodes.push(<span key={1} style={
                    {background: "palegreen"}
                }>{parts[1]}</span>)
                nodes.push(<span key={2}>{parts[2]}</span>)
                return nodes;
            }}
        </RichTextarea>
    );
};