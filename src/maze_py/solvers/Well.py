from __future__ import annotations  # Для отложенных аннотаций типов

from collections import deque  # Используем deque для эффективной работы с очередью
from typing import Deque, Dict, List, Tuple

from ..animation import AnimationRecorder
from ..grid import Cell, MazeTree
from .base import MazeSolver


class Well(MazeSolver):
    """Вам нужно реализовать этот класс."""

    name = "Well"

    def _traverse(
        self,
        tree: MazeTree,
        target: Tuple[int, int],
        *,
        recorder: AnimationRecorder | None = None,
    ) -> Tuple[List[Cell], List[Cell]]:
        """
        Реализуйте DFS!

        Подсказки:
        1. Используйте стек вместо очереди
        2. Для стека в Python можно использовать list
        3. stack.pop() удаляет последний элемент
        4. stack.append() добавляет в конец
        """

        target_cell = tree.grid.cell(*target)
        stack: Deque[Cell] = deque([tree.root])
        parents: Dict[Cell, Cell | None] = {tree.root: None}
        explored: List[Cell] = []

        while stack:
            cell = stack.pop()

            if cell in explored:
                continue
            explored.append(cell)

            if recorder:
                recorder.record(
                    "solve",
                    "explore",
                    cell=list(cell.coords),
                    parent=list(parents[cell].coords) if parents[cell] else None,
                )

            if cell is target_cell:
                break

            for neighbor in cell.links:
                if neighbor in parents:
                    continue
                parents[neighbor] = cell
                stack.append(neighbor)

        path = self._build_path(parents, target_cell)

        if path and recorder:
            recorder.record(
                "solve",
                "path",
                cells=[list(step.coords) for step in path],
            )

        return path, explored