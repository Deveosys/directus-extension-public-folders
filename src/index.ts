import { defineHook } from "@directus/extensions-sdk";

export default defineHook(({ action }, { database, logger }) => {
    action("folders.delete", async (input) => {
        let directusPermission = await database("directus_permissions")
            .where({
                role: null,
                collection: "directus_files",
                action: "read",
            })
            .first();

        if (directusPermission?.permissions) {
            // PUBLIC Read Permissions Found
            let permissions = JSON.parse(directusPermission.permissions);

            if (permissions._and) {
                let updated = false;
                for (const _andPermissions of permissions._and) {
                    if (_andPermissions._or) {
                        for (const _orPermissions of _andPermissions._or) {
                            if (_orPermissions.folder?.id?._in) {
                                for (const key of input.keys) {
                                    const index = _orPermissions.folder.id._in.indexOf(key);
                                    if (index > -1) {
                                        // Permission _orPermissions.folder?.id?._in FOUND - folder removed from existing _in permissions
                                        _orPermissions.folder?.id?._in.splice(index, 1);
                                        updated = true;
                                    }
                                }
                            }
                        }
                        break;
                    }
                }

                if (updated) {
                    await database("directus_permissions")
                        .update({
                            permissions: JSON.stringify(permissions),
                        })
                        .where({
                            role: null,
                            collection: "directus_files",
                            action: "read",
                        });
                    logger.info("Public folder deleted. PUBLIC Read permissions for directus_files updated.");
                }
            }
        }
    });

    action("folders.create", async (input) => {
        // Is folder named 'public' or is child of a 'public' folder
        let isUnderPublic = false;
        const fetchParent = async (id: string) => {
            const folder = await database("directus_folders").where({ id }).first();
            if (folder) {
                if (folder.name === "public") {
                    isUnderPublic = true;
                    return;
                }
                if (folder.parent) {
                    await fetchParent(folder.parent);
                }
            }
        };

        if (input.payload.name === "public") {
            isUnderPublic = true;
        } else {
            await fetchParent(input.key);
        }

        if (!isUnderPublic) return;

        logger.info("Created folder is public. Updating permissions.");

        let directusPermission = await database("directus_permissions")
            .where({
                role: null,
                collection: "directus_files",
                action: "read",
            })
            .first();

        if (!directusPermission) {
            logger.info("No PUBLIC Read permissions found for directus_files. Creating one.");
            await database("directus_permissions").insert({
                role: null,
                collection: "directus_files",
                action: "read",
                permissions: JSON.stringify({
                    _and: [
                        {
                            _or: [{ folder: { id: { _in: [input.key] } } }],
                        },
                    ],
                }),
            });
            logger.info("PUBLIC Read permissions for directus_files created.");
            return;
        } else if (directusPermission.permissions) {
            let permissions = JSON.parse(directusPermission.permissions);
            logger.info("PUBLIC Read permissions for directus_files found.");

            if (!permissions._and) {
                logger.info("Found  'All Access' PUBLIC Read permissions for directus_files, no permissions updated.");
                // It means all access is allowed
                return;
            } else {
                // Targeted permissions structure is:
                // { _and: [
                //         {
                //             _or: [
                //                 { folder: { id: { _in: [...public_folder_ids] } } },
                //             ],
                //         },
                // ],}

                let _orFound = false;
                for (const _andPermissions of permissions._and) {
                    if (_andPermissions._or) {
                        let _folder_id_inFound = false;
                        for (const _orPermissions of _andPermissions._or) {
                            if (_orPermissions.folder?.id?._in) {
                                _orPermissions.folder?.id?._in.push(input.key);
                                _folder_id_inFound = true;
                                // Permission _orPermissions.folder?.id?._in FOUND - folder added to existing _in group permissions
                                break;
                            }
                        }
                        if (!_folder_id_inFound) {
                            // Permission _orPermissions.folder?.id?._in NOT FOUND - new OR group added
                            _andPermissions._or.push({
                                folder: {
                                    id: {
                                        _in: [input.key],
                                    },
                                },
                            });
                        }
                        _orFound = true;
                        break;
                    }
                }

                if (!_orFound) {
                    // Permission _or NOT FOUND - new OR group permission created to _and
                    permissions._and.push({
                        _or: [{ folder: { id: { _in: [input.key] } } }],
                    });
                }
            }

            await database("directus_permissions")
                .where({
                    role: null,
                    collection: "directus_files",
                    action: "read",
                })
                .update({
                    permissions: JSON.stringify(permissions),
                });
            logger.info("PUBLIC Read permissions for directus_files updated.");
        }
    });
});
