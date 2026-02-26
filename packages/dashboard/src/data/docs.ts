export interface CommandFlag {
  flag: string
  descriptionKey: string
  required?: boolean
}

export interface Command {
  name: string
  descriptionKey: string
  usage: string
  flags?: CommandFlag[]
  examples?: string[]
}

export interface CommandGroup {
  id: string
  titleKey: string
  descriptionKey: string
  commands: Command[]
}

export interface DocSection {
  id: string
  titleKey: string
  children?: { id: string; titleKey: string }[]
}

export const sidebarSections: DocSection[] = [
  {
    id: 'getting-started',
    titleKey: 'landing.docs.sidebar.gettingStarted',
    children: [
      { id: 'prerequisites', titleKey: 'landing.docs.sidebar.prerequisites' },
      { id: 'installation', titleKey: 'landing.docs.sidebar.installation' },
      { id: 'first-deploy', titleKey: 'landing.docs.sidebar.firstDeploy' },
    ],
  },
  {
    id: 'cli-reference',
    titleKey: 'landing.docs.sidebar.cliReference',
    children: [
      { id: 'authentication', titleKey: 'landing.docs.sidebar.authentication' },
      { id: 'services', titleKey: 'landing.docs.sidebar.services' },
      { id: 'domains', titleKey: 'landing.docs.sidebar.domains' },
      { id: 'backups', titleKey: 'landing.docs.sidebar.backups' },
      { id: 'ssh-keys', titleKey: 'landing.docs.sidebar.sshKeys' },
      { id: 'marketplace', titleKey: 'landing.docs.sidebar.marketplace' },
      { id: 'infrastructure', titleKey: 'landing.docs.sidebar.infrastructure' },
    ],
  },
  {
    id: 'storage',
    titleKey: 'landing.docs.sidebar.storage',
    children: [
      { id: 'storage-overview', titleKey: 'landing.docs.sidebar.storageOverview' },
      { id: 'storage-providers', titleKey: 'landing.docs.sidebar.storageProviders' },
      { id: 'storage-node-setup', titleKey: 'landing.docs.sidebar.storageNodeSetup' },
      { id: 'storage-specs', titleKey: 'landing.docs.sidebar.storageSpecs' },
      { id: 'storage-migration', titleKey: 'landing.docs.sidebar.storageMigration' },
    ],
  },
  {
    id: 'networking',
    titleKey: 'landing.docs.sidebar.networking',
    children: [
      { id: 'networking-ports', titleKey: 'landing.docs.sidebar.networkingPorts' },
      { id: 'networking-firewall', titleKey: 'landing.docs.sidebar.networkingFirewall' },
      { id: 'networking-sftp', titleKey: 'landing.docs.sidebar.networkingSftp' },
    ],
  },
  {
    id: 'integrations',
    titleKey: 'landing.docs.sidebar.integrations',
    children: [
      { id: 'deploy-button', titleKey: 'landing.docs.sidebar.deployButton' },
      { id: 'fleet-json', titleKey: 'landing.docs.sidebar.fleetJson' },
    ],
  },
  {
    id: 'configuration',
    titleKey: 'landing.docs.sidebar.configuration',
  },
]

export const commandGroups: CommandGroup[] = [
  {
    id: 'authentication',
    titleKey: 'landing.docs.cmd.auth.title',
    descriptionKey: 'landing.docs.cmd.auth.desc',
    commands: [
      {
        name: 'fleet login',
        descriptionKey: 'landing.docs.cmd.auth.loginDesc',
        usage: 'fleet login [options]',
        flags: [
          { flag: '--api-url <url>', descriptionKey: 'landing.docs.cmd.auth.loginFlagApiUrl' },
        ],
        examples: [
          '$ fleet login',
          '$ fleet login --api-url https://fleet.example.com',
        ],
      },
      {
        name: 'fleet logout',
        descriptionKey: 'landing.docs.cmd.auth.logoutDesc',
        usage: 'fleet logout',
        examples: ['$ fleet logout'],
      },
      {
        name: 'fleet whoami',
        descriptionKey: 'landing.docs.cmd.auth.whoamiDesc',
        usage: 'fleet whoami',
        examples: ['$ fleet whoami'],
      },
    ],
  },
  {
    id: 'services',
    titleKey: 'landing.docs.cmd.services.title',
    descriptionKey: 'landing.docs.cmd.services.desc',
    commands: [
      {
        name: 'fleet deploy',
        descriptionKey: 'landing.docs.cmd.services.deployDesc',
        usage: 'fleet deploy --name <name> --image <image> [options]',
        flags: [
          { flag: '--name <name>', descriptionKey: 'landing.docs.cmd.services.deployFlagName', required: true },
          { flag: '--image <image>', descriptionKey: 'landing.docs.cmd.services.deployFlagImage', required: true },
          { flag: '--replicas <n>', descriptionKey: 'landing.docs.cmd.services.deployFlagReplicas' },
          { flag: '--env <KEY=VAL>', descriptionKey: 'landing.docs.cmd.services.deployFlagEnv' },
        ],
        examples: [
          '$ fleet deploy --name my-app --image node:20',
          '$ fleet deploy --name api --image myapp:latest --replicas 3 --env PORT=8080 --env NODE_ENV=production',
        ],
      },
      {
        name: 'fleet services',
        descriptionKey: 'landing.docs.cmd.services.listDesc',
        usage: 'fleet services',
        examples: ['$ fleet services'],
      },
      {
        name: 'fleet logs',
        descriptionKey: 'landing.docs.cmd.services.logsDesc',
        usage: 'fleet logs <service> [options]',
        flags: [
          { flag: '-f, --follow', descriptionKey: 'landing.docs.cmd.services.logsFlagFollow' },
          { flag: '--tail <n>', descriptionKey: 'landing.docs.cmd.services.logsFlagTail' },
        ],
        examples: [
          '$ fleet logs my-app',
          '$ fleet logs my-app --tail 50',
        ],
      },
      {
        name: 'fleet scale',
        descriptionKey: 'landing.docs.cmd.services.scaleDesc',
        usage: 'fleet scale <service> <replicas>',
        examples: ['$ fleet scale my-app 5'],
      },
      {
        name: 'fleet stop',
        descriptionKey: 'landing.docs.cmd.services.stopDesc',
        usage: 'fleet stop <service>',
        examples: ['$ fleet stop my-app'],
      },
      {
        name: 'fleet start',
        descriptionKey: 'landing.docs.cmd.services.startDesc',
        usage: 'fleet start <service>',
        examples: ['$ fleet start my-app'],
      },
      {
        name: 'fleet restart',
        descriptionKey: 'landing.docs.cmd.services.restartDesc',
        usage: 'fleet restart <service>',
        examples: ['$ fleet restart my-app'],
      },
      {
        name: 'fleet destroy',
        descriptionKey: 'landing.docs.cmd.services.destroyDesc',
        usage: 'fleet destroy <service> [options]',
        flags: [
          { flag: '-f, --force', descriptionKey: 'landing.docs.cmd.services.destroyFlagForce' },
        ],
        examples: [
          '$ fleet destroy my-app',
          '$ fleet destroy my-app --force',
        ],
      },
    ],
  },
  {
    id: 'domains',
    titleKey: 'landing.docs.cmd.domains.title',
    descriptionKey: 'landing.docs.cmd.domains.desc',
    commands: [
      {
        name: 'fleet domains list',
        descriptionKey: 'landing.docs.cmd.domains.listDesc',
        usage: 'fleet domains list',
        examples: ['$ fleet domains list'],
      },
      {
        name: 'fleet domains add',
        descriptionKey: 'landing.docs.cmd.domains.addDesc',
        usage: 'fleet domains add <domain> --service <name>',
        flags: [
          { flag: '--service <name>', descriptionKey: 'landing.docs.cmd.domains.addFlagService', required: true },
        ],
        examples: ['$ fleet domains add app.example.com --service my-app'],
      },
      {
        name: 'fleet domains remove',
        descriptionKey: 'landing.docs.cmd.domains.removeDesc',
        usage: 'fleet domains remove <domain>',
        examples: ['$ fleet domains remove app.example.com'],
      },
    ],
  },
  {
    id: 'backups',
    titleKey: 'landing.docs.cmd.backups.title',
    descriptionKey: 'landing.docs.cmd.backups.desc',
    commands: [
      {
        name: 'fleet backups list',
        descriptionKey: 'landing.docs.cmd.backups.listDesc',
        usage: 'fleet backups list',
        examples: ['$ fleet backups list'],
      },
      {
        name: 'fleet backups create',
        descriptionKey: 'landing.docs.cmd.backups.createDesc',
        usage: 'fleet backups create --service <name>',
        flags: [
          { flag: '--service <name>', descriptionKey: 'landing.docs.cmd.backups.createFlagService', required: true },
        ],
        examples: ['$ fleet backups create --service my-app'],
      },
      {
        name: 'fleet backups restore',
        descriptionKey: 'landing.docs.cmd.backups.restoreDesc',
        usage: 'fleet backups restore <id>',
        examples: ['$ fleet backups restore abc123'],
      },
    ],
  },
  {
    id: 'ssh-keys',
    titleKey: 'landing.docs.cmd.sshKeys.title',
    descriptionKey: 'landing.docs.cmd.sshKeys.desc',
    commands: [
      {
        name: 'fleet ssh-keys list',
        descriptionKey: 'landing.docs.cmd.sshKeys.listDesc',
        usage: 'fleet ssh-keys list',
        examples: ['$ fleet ssh-keys list'],
      },
      {
        name: 'fleet ssh-keys add',
        descriptionKey: 'landing.docs.cmd.sshKeys.addDesc',
        usage: 'fleet ssh-keys add --name <name> --key <pubkey>',
        flags: [
          { flag: '--name <name>', descriptionKey: 'landing.docs.cmd.sshKeys.addFlagName', required: true },
          { flag: '--key <pubkey>', descriptionKey: 'landing.docs.cmd.sshKeys.addFlagKey', required: true },
        ],
        examples: ['$ fleet ssh-keys add --name "MacBook" --key "ssh-ed25519 AAAA..."'],
      },
      {
        name: 'fleet ssh-keys remove',
        descriptionKey: 'landing.docs.cmd.sshKeys.removeDesc',
        usage: 'fleet ssh-keys remove <id>',
        examples: ['$ fleet ssh-keys remove abc123'],
      },
    ],
  },
  {
    id: 'marketplace',
    titleKey: 'landing.docs.cmd.marketplace.title',
    descriptionKey: 'landing.docs.cmd.marketplace.desc',
    commands: [
      {
        name: 'fleet marketplace list',
        descriptionKey: 'landing.docs.cmd.marketplace.listDesc',
        usage: 'fleet marketplace list',
        examples: ['$ fleet marketplace list'],
      },
      {
        name: 'fleet marketplace deploy',
        descriptionKey: 'landing.docs.cmd.marketplace.deployDesc',
        usage: 'fleet marketplace deploy <slug>',
        examples: [
          '$ fleet marketplace deploy wordpress',
          '$ fleet marketplace deploy redis',
        ],
      },
    ],
  },
  {
    id: 'infrastructure',
    titleKey: 'landing.docs.cmd.infrastructure.title',
    descriptionKey: 'landing.docs.cmd.infrastructure.desc',
    commands: [
      {
        name: 'fleet init',
        descriptionKey: 'landing.docs.cmd.infrastructure.initDesc',
        usage: 'fleet init [options]',
        flags: [
          { flag: '-d, --domain <domain>', descriptionKey: 'landing.docs.cmd.infrastructure.initFlagDomain' },
          { flag: '-e, --email <email>', descriptionKey: 'landing.docs.cmd.infrastructure.initFlagEmail' },
        ],
        examples: [
          '$ fleet init',
          '$ fleet init --domain panel.example.com --email admin@example.com',
        ],
      },
      {
        name: 'fleet join',
        descriptionKey: 'landing.docs.cmd.infrastructure.joinDesc',
        usage: 'fleet join [options]',
        flags: [
          { flag: '-t, --token <token>', descriptionKey: 'landing.docs.cmd.infrastructure.joinFlagToken' },
          { flag: '-a, --address <addr>', descriptionKey: 'landing.docs.cmd.infrastructure.joinFlagAddress' },
        ],
        examples: ['$ fleet join --token SWMTKN-1-xxx --address 10.0.0.1:2377'],
      },
      {
        name: 'fleet status',
        descriptionKey: 'landing.docs.cmd.infrastructure.statusDesc',
        usage: 'fleet status',
        examples: ['$ fleet status'],
      },
    ],
  },
]
