# Preview and render segment parity

Step 3 now creates merge groups before selection. The scorer selects one segment
per group, then expands that selection back to the existing per-phrase response
shape. Every phrase carrying the same `merge_group` therefore has the same
`segment_id`, and the render's collapse confirms that choice.

Segments are clustered by transitive time overlap within a source video. The
selector applies a timeline cooldown of `min(10s, audio_duration / 3)`, relaxing
to half and then zero only when no eligible segment remains. Such relaxation
produces a `low_variety` warning displayed on the Step 3 variant card.
