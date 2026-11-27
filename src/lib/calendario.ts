/**
 * Calendario page behaviour: measures the sticky chrome, runs the jornada
 * picker (a portalled listbox, same pattern as the Estadísticas team filter),
 * keeps the bar label in sync with the section under it, and jumps to the next
 * jornada on a fresh load.
 *
 * The pure helpers at the top are also imported by `src/pages/calendario.astro`
 * during SSR, so nothing may touch `document` at module scope.
 */

const TEST_TODAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Height of the fade band hanging under the sticky bar, in px. Written to
 * `--cal-fade-h` so the band's CSS height, the jump offset and the scroll-spy
 * line cannot drift apart.
 */
const FADE_HEIGHT = 32;

export interface SectionDates {
	id: string;
	lastDate: string;
}

/** One row of the jornada picker, shared with `JornadaPicker.astro`. */
export interface PickerSection extends SectionDates {
	short: string;
	title: string;
	date: string;
	/** Full trigger text, e.g. `Jornada 4 · sáb, 14 nov`. */
	label: string;
}

/** Today as `YYYY-MM-DD` in the visitor's local timezone (never UTC). */
export function todayISO(now: Date = new Date()): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * Index of the section to land on: the first one whose last date is today or
 * later. Once the whole season is in the past it falls back to the last section.
 */
export function nextSectionIndex(sections: SectionDates[], today: string): number {
	if (sections.length === 0) return -1;
	const index = sections.findIndex((section) => section.lastDate >= today);
	return index === -1 ? sections.length - 1 : index;
}

/** `?today=YYYY-MM-DD` override, dev builds only, to test the jump rule. */
function testToday(): string | null {
	if (!import.meta.env.DEV) return null;
	const value = new URLSearchParams(window.location.search).get('today');
	return value !== null && TEST_TODAY_RE.test(value) ? value : null;
}

function init(): void {
	const bar = document.querySelector<HTMLElement>('[data-cal-bar]');
	const toggle = document.querySelector<HTMLButtonElement>('[data-jornada-toggle]');
	const label = document.querySelector<HTMLElement>('[data-jornada-label]');
	const menu = document.querySelector<HTMLElement>('[data-jornada-menu]');
	const sectionEls = Array.from(document.querySelectorAll<HTMLElement>('[data-section]'));
	if (!bar || !toggle || !label || !menu || sectionEls.length === 0) return;

	const options = Array.from(menu.querySelectorAll<HTMLElement>('[data-jornada-value]'));
	const nav = document.querySelector<HTMLElement>('body > header');
	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	const sections: SectionDates[] = sectionEls.map((element) => ({
		id: element.id,
		lastDate: element.dataset.lastDate ?? '',
	}));

	// --- sticky chrome -------------------------------------------------------

	let navHeight = 0;
	let barHeight = 0;

	const syncChrome = () => {
		navHeight = nav?.offsetHeight ?? 0;
		barHeight = bar.offsetHeight;
		const root = document.documentElement;
		root.style.setProperty('--cal-nav-h', `${navHeight}px`);
		root.style.setProperty('--cal-bar-h', `${barHeight}px`);
		root.style.setProperty('--cal-fade-h', `${FADE_HEIGHT}px`);
	};

	syncChrome();
	window.addEventListener('resize', syncChrome);
	window.addEventListener('orientationchange', syncChrome);
	// A late web-font swap must not leave the sticky offsets stale.
	if (document.fonts) void document.fonts.ready.then(syncChrome);

	// --- navigation ----------------------------------------------------------

	const jumpTo = (id: string, behavior: ScrollBehavior) => {
		document.getElementById(id)?.scrollIntoView({ block: 'start', behavior });
	};

	let activeId = '';

	const setActive = (id: string) => {
		if (id === activeId) return;
		activeId = id;
		const option = options.find((item) => item.dataset.jornadaValue === id);
		if (option) {
			const text = option.dataset.jornadaLabel ?? '';
			label.textContent = text;
			// Keeps the tooltip useful when the trigger truncates on narrow screens.
			label.title = text;
		}
		for (const item of options) {
			item.setAttribute('aria-selected', item === option ? 'true' : 'false');
		}
	};

	let frame = 0;

	const updateActive = () => {
		frame = 0;
		// +1 absorbs the sub-pixel offset a scrollIntoView landing can leave, so
		// the section a jump lands on is the one the label reports.
		const line = navHeight + barHeight + FADE_HEIGHT + 1;
		let current = sections[0]?.id ?? '';
		for (const section of sections) {
			const element = document.getElementById(section.id);
			if (element && element.getBoundingClientRect().top <= line) current = section.id;
		}
		if (current) setActive(current);
	};

	window.addEventListener(
		'scroll',
		() => {
			if (frame) return;
			frame = window.requestAnimationFrame(updateActive);
		},
		{ passive: true },
	);

	// --- today / next jornada ------------------------------------------------

	const today = testToday() ?? todayISO();
	const nextIndex = nextSectionIndex(sections, today);
	const nextId = nextIndex >= 0 ? (sections[nextIndex]?.id ?? '') : '';

	for (const option of options) {
		if ((option.dataset.jornadaLast ?? '') < today) option.dataset.played = '';
		if (option.dataset.jornadaValue === nextId) option.dataset.next = '';
	}

	const hash = decodeURIComponent(window.location.hash.slice(1));
	const navigation = performance.getEntriesByType('navigation')[0] as
		| PerformanceNavigationTiming
		| undefined;
	// Back/forward and reload keep the browser's own scroll position.
	const freshLoad = !navigation || navigation.type === 'navigate';

	window.requestAnimationFrame(() => {
		if (hash && document.getElementById(hash)) jumpTo(hash, 'auto');
		else if (freshLoad && nextId) jumpTo(nextId, 'auto');
		updateActive();
	});

	// --- jornada picker ------------------------------------------------------

	// Moved out of the sticky bar so it can never be clipped by it.
	document.body.appendChild(menu);

	let menuOpen = false;
	let closeTimer: number | undefined;

	const positionMenu = () => {
		const rect = toggle.getBoundingClientRect();
		const margin = 8;
		menu.style.minWidth = `${Math.max(Math.round(rect.width), 208)}px`;
		const width = menu.offsetWidth;
		const height = menu.offsetHeight;
		const left = Math.min(
			Math.max(margin, rect.right - width),
			window.innerWidth - width - margin,
		);
		const top = Math.min(rect.bottom + 6, window.innerHeight - height - margin);
		menu.style.left = `${left}px`;
		menu.style.top = `${Math.max(margin, top)}px`;
	};

	const openMenu = () => {
		menuOpen = true;
		window.clearTimeout(closeTimer);
		menu.hidden = false;
		positionMenu();
		// Paint the closed state before transitioning to open.
		void menu.offsetWidth;
		menu.dataset.open = '';
		toggle.dataset.open = '';
		toggle.setAttribute('aria-expanded', 'true');

		const selected =
			options.find((item) => item.getAttribute('aria-selected') === 'true') ?? options[0];
		if (selected) {
			selected.focus({ preventScroll: true });
			selected.scrollIntoView({ block: 'nearest' });
		}
	};

	const closeMenu = (restoreFocus = false) => {
		if (!menuOpen) return;
		menuOpen = false;
		delete menu.dataset.open;
		delete toggle.dataset.open;
		toggle.setAttribute('aria-expanded', 'false');
		window.clearTimeout(closeTimer);
		closeTimer = window.setTimeout(() => {
			if (!menuOpen) menu.hidden = true;
		}, 100);
		if (restoreFocus) toggle.focus();
	};

	const selectOption = (option: HTMLElement) => {
		const id = option.dataset.jornadaValue;
		closeMenu();
		if (!id) return;
		jumpTo(id, reduceMotion ? 'auto' : 'smooth');
		history.replaceState(null, '', `#${id}`);
		setActive(id);
	};

	toggle.addEventListener('click', () => {
		if (menuOpen) closeMenu();
		else openMenu();
	});

	toggle.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown' && !menuOpen) {
			event.preventDefault();
			openMenu();
		}
	});

	for (const option of options) {
		option.addEventListener('click', () => selectOption(option));
	}

	menu.addEventListener('keydown', (event) => {
		const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const index = focused ? options.indexOf(focused) : -1;

		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp': {
				event.preventDefault();
				const delta = event.key === 'ArrowDown' ? 1 : -1;
				const next = (index + delta + options.length) % options.length;
				options[next]?.focus();
				break;
			}
			case 'Home':
				event.preventDefault();
				options[0]?.focus();
				break;
			case 'End':
				event.preventDefault();
				options[options.length - 1]?.focus();
				break;
			case 'Enter':
			case ' ': {
				event.preventDefault();
				const option = index >= 0 ? options[index] : undefined;
				if (option) selectOption(option);
				break;
			}
			case 'Escape':
				event.preventDefault();
				closeMenu(true);
				break;
			case 'Tab':
				closeMenu();
				break;
		}
	});

	document.addEventListener('pointerdown', (event) => {
		if (!menuOpen) return;
		const target = event.target as Node;
		if (menu.contains(target) || toggle.contains(target)) return;
		closeMenu();
	});

	window.addEventListener(
		'scroll',
		(event) => {
			if (!menuOpen) return;
			// Scrolling the list itself must not close it.
			if (event.target instanceof Node && menu.contains(event.target)) return;
			closeMenu();
		},
		true,
	);

	window.addEventListener('resize', () => {
		if (menuOpen) positionMenu();
	});
}

if (typeof document !== 'undefined') {
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
}
