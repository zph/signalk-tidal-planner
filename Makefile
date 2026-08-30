.PHONY: serve stop

PORT ?= 8000

serve: stop
	@url="http://localhost:$(PORT)"; \
	echo "Opening $$url..."; \
	(sleep 0.5; open "$$url") &
	python3 -m http.server $(PORT) --directory public

stop:
	@pids="$$(lsof -tiTCP:$(PORT) -sTCP:LISTEN 2>/dev/null)"; \
	if [ -n "$$pids" ]; then \
		echo "Stopping existing server on port $(PORT)..."; \
		kill $$pids 2>/dev/null || true; \
		attempts=0; \
		while lsof -tiTCP:$(PORT) -sTCP:LISTEN >/dev/null 2>&1 && [ $$attempts -lt 20 ]; do \
			sleep 0.1; attempts=$$((attempts + 1)); \
		done; \
		remaining="$$(lsof -tiTCP:$(PORT) -sTCP:LISTEN 2>/dev/null)"; \
		if [ -n "$$remaining" ]; then kill -KILL $$remaining; fi; \
	fi
