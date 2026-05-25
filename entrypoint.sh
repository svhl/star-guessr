#!/bin/sh
# Fix /data ownership in case the named volume was created with root ownership
chown -R nodejs:nodejs /data
exec su-exec nodejs "$@"
